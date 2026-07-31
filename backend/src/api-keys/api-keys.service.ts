import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { API_SCOPES, CreateApiKeyDto, UpdateApiKeyDto } from './dto';

/** 校验通过后挂到请求上的 API Key 上下文 */
export interface ApiKeyContext {
  id: string;
  name: string;
  organizationId: string;
  creatorId: string;
  scopes: string[];
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  /**
   * lastUsedAt 写入节流：同一 key 60s 内只落库一次，
   * 避免高频调用把 API Key 表打成写热点。
   */
  private readonly lastUsedTouchedAt = new Map<string, number>();
  private static readonly TOUCH_INTERVAL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 生成 / 哈希 ====================

  /**
   * 明文密钥形如 `ak_<43 位 base64url>`，只在创建时返回一次。
   * 库里只存 sha256 摘要 + 前缀（用于列表识别）。
   */
  private generatePlainKey(): string {
    return `ak_${randomBytes(32).toString('base64url')}`;
  }

  private hashKey(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  // ==================== CRUD ====================

  async list(organizationId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async create(organizationId: string, creatorId: string, dto: CreateApiKeyDto) {
    const plain = this.generatePlainKey();
    const scopes =
      dto.scopes && dto.scopes.length
        ? dto.scopes
        : (API_SCOPES as unknown as string[]);

    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('expiresAt 不是合法时间');
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('过期时间必须晚于当前时间');
      }
    }

    const row = await this.prisma.apiKey.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        keyHash: this.hashKey(plain),
        keyPrefix: plain.slice(0, 11),
        scopes,
        expiresAt,
        status: 'active',
      },
    });

    this.logger.log(`[ApiKeys] created ${row.id} (${row.name}) org=${organizationId}`);

    // plainKey 仅此一次返回，之后无法找回
    return { ...this.toView(row), plainKey: plain };
  }

  async update(id: string, organizationId: string, dto: UpdateApiKeyDto) {
    await this.mustFind(id, organizationId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.scopes !== undefined) data.scopes = dto.scopes;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.expiresAt !== undefined) {
      // 空字符串 = 清除过期时间
      if (!dto.expiresAt) {
        data.expiresAt = null;
      } else {
        const d = new Date(dto.expiresAt);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException('expiresAt 不是合法时间');
        }
        data.expiresAt = d;
      }
    }

    const row = await this.prisma.apiKey.update({ where: { id }, data });
    return this.toView(row);
  }

  /** 吊销（软失效，保留调用历史可追溯） */
  async revoke(id: string, organizationId: string) {
    await this.mustFind(id, organizationId);
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { status: 'revoked' },
    });
    this.logger.log(`[ApiKeys] revoked ${id}`);
    return this.toView(row);
  }

  /** 轮换：保留同一条记录的 name/scopes，仅替换密钥本体 */
  async rotate(id: string, organizationId: string) {
    await this.mustFind(id, organizationId);
    const plain = this.generatePlainKey();
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: {
        keyHash: this.hashKey(plain),
        keyPrefix: plain.slice(0, 11),
        status: 'active',
        lastUsedAt: null,
      },
    });
    this.lastUsedTouchedAt.delete(id);
    this.logger.log(`[ApiKeys] rotated ${id}`);
    return { ...this.toView(row), plainKey: plain };
  }

  async remove(id: string, organizationId: string) {
    await this.mustFind(id, organizationId);
    await this.prisma.apiKey.delete({ where: { id } });
    this.lastUsedTouchedAt.delete(id);
    return { id };
  }

  // ==================== 校验（供 ApiKeyGuard 调用）====================

  /**
   * 校验明文密钥。失败一律返回 null，由 Guard 统一抛 401，
   * 不区分"不存在/已吊销/已过期"以免成为枚举探测面。
   */
  async verify(plainKey: string): Promise<ApiKeyContext | null> {
    if (!plainKey || !plainKey.startsWith('ak_')) return null;

    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.hashKey(plainKey) },
    });
    if (!row) return null;
    if (row.status !== 'active') return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

    this.touchLastUsed(row.id);

    return {
      id: row.id,
      name: row.name,
      organizationId: row.organizationId,
      creatorId: row.creatorId,
      scopes: row.scopes || [],
    };
  }

  /** 节流写 lastUsedAt，失败不影响主流程 */
  private touchLastUsed(id: string) {
    const now = Date.now();
    const last = this.lastUsedTouchedAt.get(id) || 0;
    if (now - last < ApiKeysService.TOUCH_INTERVAL_MS) return;
    this.lastUsedTouchedAt.set(id, now);

    this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((e) =>
        this.logger.warn(`[ApiKeys] touch lastUsedAt failed ${id}: ${e?.message}`),
      );
  }

  // ==================== 内部 ====================

  private async mustFind(id: string, organizationId: string) {
    const row = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundException('API Key 不存在');
    return row;
  }

  /** 永不外泄 keyHash */
  private toView(row: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    status: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    creatorId: string;
    organizationId: string;
  }) {
    const expired = !!row.expiresAt && row.expiresAt.getTime() <= Date.now();
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      maskedKey: `${row.keyPrefix}${'*'.repeat(8)}`,
      scopes: row.scopes || [],
      status: expired ? 'expired' : row.status,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      creatorId: row.creatorId,
      organizationId: row.organizationId,
    };
  }
}
