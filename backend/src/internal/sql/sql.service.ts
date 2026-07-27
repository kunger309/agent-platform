import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ALLOWED_PREFIXES,
  ALLOWED_TABLES,
  FORBIDDEN_KEYWORDS,
  MAX_ROWS,
  MAX_SQL_LENGTH,
  QUERY_TIMEOUT_MS,
} from './sql.constants';

/**
 * 内部只读 SQL 查询服务。
 *
 * 工作流 HTTP 节点会 POST { sql: "..." } 到 /api/internal/sql/query，
 * 本服务在执行前做严格白名单校验：
 *   1) trim 注释 + 长度限制
 *   2) 关键字黑名单（INSERT/UPDATE/DELETE/DDL/...）
 *   3) 必须以 SELECT/WITH/EXPLAIN/VALUES/TABLE 开头
 *   4) 禁止多语句
 *   5) FROM/JOIN 引用的表必须在 ALLOWED_TABLES
 * 配合 LocalOnlyGuard 限制只允许本机调用，整体构成一个最小可信的网关。
 *
 * ⚠️ 生产环境仍应在 Postgres 层额外配 readonly role 做纵深防御。
 */
@Injectable()
export class SqlService {
  private readonly logger = new Logger(SqlService.name);

  constructor(private readonly prisma: PrismaService) {}

  async query(rawSql: string): Promise<{
    ok: true;
    rows: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    fields: string[];
    rowCount: number;
    truncated: boolean;
    durationMs: number;
  }> {
    if (typeof rawSql !== 'string' || rawSql.length === 0) {
      throw new BadRequestException('sql 不能为空');
    }
    if (rawSql.length > MAX_SQL_LENGTH) {
      throw new BadRequestException(`sql 不能超过 ${MAX_SQL_LENGTH} 字符`);
    }

    // 1) 去掉 /* ... */ 多行注释 和 -- 行注释，再 trim
    const cleaned = this.stripComments(rawSql).trim();
    if (!cleaned) {
      throw new BadRequestException('sql 为空（可能全是注释）');
    }

    // 2) 禁止多语句：只允许末尾可选一个分号
    const semiCount = (cleaned.match(/;/g) || []).length;
    if (semiCount > 1 || (semiCount === 1 && !cleaned.endsWith(';'))) {
      throw new BadRequestException('仅允许单条 SQL 语句');
    }
    const stmt = cleaned.replace(/;$/, '').trim();

    // 3) 关键字黑名单（按词边界）
    for (const kw of FORBIDDEN_KEYWORDS) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(stmt)) {
        throw new BadRequestException(`禁止使用关键字: ${kw.toUpperCase()}`);
      }
    }

    // 4) 起始 token 必须在白名单内
    const firstToken = stmt.split(/\s+/, 1)[0].toLowerCase();
    if (!ALLOWED_PREFIXES.includes(firstToken)) {
      throw new BadRequestException(
        `SQL 必须以 ${ALLOWED_PREFIXES.join('/').toUpperCase()} 之一开头`,
      );
    }

    // 5) 表白名单：扫描所有 FROM/JOIN 后的标识符
    const tables = this.extractTableNames(stmt);
    if (tables.length === 0 && firstToken !== 'values') {
      // SELECT 1 / EXPLAIN 这种无表查询允许；其他场景若无表也不致命
      // 但生产里大多数查询都该有表，留个软提示
      this.logger.debug(`[Sql] no table detected: ${stmt.slice(0, 80)}...`);
    }
    for (const t of tables) {
      if (!ALLOWED_TABLES.has(t)) {
        throw new BadRequestException(`表 "${t}" 不在白名单中`);
      }
    }

    // 6) 执行 + 超时
    const t0 = Date.now();
    let rows: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      rows = (await Promise.race([
        this.prisma.$queryRawUnsafe(stmt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`SQL 执行超时（${QUERY_TIMEOUT_MS}ms）`)),
            QUERY_TIMEOUT_MS,
          ),
        ),
      ])) as any[];
    } catch (e: any) {
      // Prisma 把 Postgres 错误包成一堆对象，message 里能拿到 detail
      const msg = e?.message || String(e);
      throw new BadRequestException(`SQL 执行失败: ${msg.slice(0, 300)}`);
    }

    const durationMs = Date.now() - t0;
    const truncated = rows.length > MAX_ROWS;
    const sliced = truncated ? rows.slice(0, MAX_ROWS) : rows;
    // Prisma 把 PG bigint 转成 JS BigInt；JSON.stringify 无法序列化 BigInt
    // 这里统一转成 number（无精度风险：PG count 在 int8 范围内不会超 Number 安全值）
    const normalized = sliced.map((r: any) => this.serializeBigInts(r));
    const fields = normalized.length > 0 ? Object.keys(normalized[0]) : [];

    return {
      ok: true,
      rows: normalized,
      fields,
      rowCount: normalized.length,
      truncated,
      durationMs,
    };
  }

  /**
   * 递归把对象里的 BigInt 转成 Number；Date 保留原样（Prisma 默认序列化为 ISO 字符串）。
   * 仅处理 number/string/boolean/null/array/object；其他原样返回。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeBigInts(v: any): any {
    if (v == null) return v;
    if (typeof v === 'bigint') {
      // Number 安全整数范围 ±2^53；count/count(distinct) 等聚合不会超
      const n = Number(v);
      // 超出安全范围时退回字符串，避免精度丢失
      if (!Number.isSafeInteger(n)) return v.toString();
      return n;
    }
    if (Array.isArray(v)) return v.map((x) => this.serializeBigInts(x));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) out[k] = this.serializeBigInts(v[k]);
      return out;
    }
    return v;
  }

  /** 去掉 SQL 块注释（slash-star ... star-slash）与 -- 行注释。保留字符串字面量。 */
  private stripComments(sql: string): string {
    let out = '';
    let i = 0;
    const n = sql.length;
    let mode: 'code' | 'sq' | 'dq' | 'block' | 'line' = 'code';
    while (i < n) {
      const ch = sql[i];
      const next = sql[i + 1];
      if (mode === 'code') {
        if (ch === "'" && sql[i - 1] !== '\\') {
          mode = 'sq';
          out += ch;
          i++;
        } else if (ch === '"' && sql[i - 1] !== '\\') {
          mode = 'dq';
          out += ch;
          i++;
        } else if (ch === '/' && next === '*') {
          mode = 'block';
          i += 2;
        } else if (ch === '-' && next === '-') {
          mode = 'line';
          i += 2;
        } else {
          out += ch;
          i++;
        }
      } else if (mode === 'sq') {
        if (ch === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        if (ch === "'") mode = 'code';
        out += ch;
        i++;
      } else if (mode === 'dq') {
        if (ch === '"' && sql[i + 1] === '"') {
          out += '""';
          i += 2;
          continue;
        }
        if (ch === '"') mode = 'code';
        out += ch;
        i++;
      } else if (mode === 'block') {
        if (ch === '*' && next === '/') {
          mode = 'code';
          i += 2;
        } else {
          i++;
        }
      } else if (mode === 'line') {
        if (ch === '\n') {
          mode = 'code';
          out += ch;
          i++;
        } else {
          i++;
        }
      }
    }
    return out;
  }

  /**
   * 提取 SQL 中 FROM / JOIN 之后的表名（含 schema 前缀则取点号后的部分）。
   * 不解析复杂 CTE，但能覆盖最常见的 SELECT/JOIN 场景。
   */
  private extractTableNames(sql: string): string[] {
    const result: string[] = [];
    const re = /\b(from|join)\s+([a-zA-Z_][\w]*\.)?([a-zA-Z_][\w]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const tbl = m[3].toLowerCase();
      // 过滤关键字 / 伪表名（如 JOIN users u 中的 u 不匹配此正则，因为 u 不是 FROM/JOIN 后）
      // 还要过滤子查询别名等情况：通常 FROM (SELECT ... ) sub 中的 sub 不会以字母下划线开头，OK
      if (
        !ALLOWED_TABLES.has(tbl) &&
        !FORBIDDEN_KEYWORDS.includes(tbl) &&
        tbl !== 'select' &&
        tbl !== 'unnest' &&
        tbl !== 'jsonb_each'
      ) {
        result.push(tbl);
      }
    }
    return Array.from(new Set(result));
  }
}