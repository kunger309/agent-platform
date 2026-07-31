import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis as RedisClient } from 'ioredis';

interface MemoryEntry {
  value: string;
  expireAt: number;
}

/**
 * 统一缓存服务。
 *
 * 设计原则：
 * - Redis 可用则用 Redis；不可用（未部署 / 连不上）自动降级到进程内存，
 *   业务代码无需关心，也不会因为没装 Redis 就跑不起来。
 * - 内存模式有条数上限 + 惰性过期，避免长跑进程内存无限增长。
 * - 缓存层任何异常都被吞掉并回退为"未命中"，绝不影响主链路。
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  private redis: RedisClient | null = null;
  private redisReady = false;

  private readonly memory = new Map<string, MemoryEntry>();
  private static readonly MEMORY_MAX_ENTRIES = 5000;

  private hits = 0;
  private misses = 0;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    const host = this.config.get<string>('REDIS_HOST');
    if (!url && !host) {
      this.logger.log('[Cache] 未配置 Redis，使用进程内存缓存');
      return;
    }

    try {
      // 动态引入：没装 ioredis 也不至于让应用起不来
      const { default: Redis } = await import('ioredis');
      const client: RedisClient = url
        ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 })
        : new Redis({
            host,
            port: Number(this.config.get<string>('REDIS_PORT') || 6379),
            password: this.config.get<string>('REDIS_PASSWORD') || undefined,
            db: Number(this.config.get<string>('REDIS_DB') || 0),
            lazyConnect: true,
            maxRetriesPerRequest: 1,
          });

      client.on('error', (e: any) => {
        if (this.redisReady) {
          this.logger.warn(`[Cache] Redis 错误，暂时降级内存：${e?.message}`);
        }
        this.redisReady = false;
      });
      client.on('ready', () => {
        this.redisReady = true;
        this.logger.log('[Cache] Redis 已连接');
      });

      await client.connect();
      this.redis = client;
      this.redisReady = true;
    } catch (e: any) {
      this.logger.warn(`[Cache] Redis 连接失败，降级内存缓存：${e?.message}`);
      this.redis = null;
      this.redisReady = false;
    }
  }

  async onModuleDestroy() {
    try {
      await this.redis?.quit();
    } catch {
      /* ignore */
    }
  }

  get backend(): 'redis' | 'memory' {
    return this.redis && this.redisReady ? 'redis' : 'memory';
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      backend: this.backend,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 10 : null,
      memoryEntries: this.memory.size,
    };
  }

  // ==================== 基础读写 ====================

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      let raw: string | null = null;
      if (this.redis && this.redisReady) {
        raw = await this.redis.get(key);
      } else {
        const e = this.memory.get(key);
        if (e) {
          if (e.expireAt > Date.now()) raw = e.value;
          else this.memory.delete(key);
        }
      }
      if (raw == null) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(raw) as T;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 3600): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (this.redis && this.redisReady) {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
        return;
      }
      if (this.memory.size >= CacheService.MEMORY_MAX_ENTRIES) {
        this.evictMemory();
      }
      this.memory.set(key, { value: raw, expireAt: Date.now() + ttlSeconds * 1000 });
    } catch {
      /* 写缓存失败不影响主流程 */
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (this.redis && this.redisReady) await this.redis.del(key);
      else this.memory.delete(key);
    } catch {
      /* ignore */
    }
  }

  /** 按前缀清理（内存模式遍历，Redis 用 scan，避免 KEYS 阻塞） */
  async delByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    try {
      if (this.redis && this.redisReady) {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            200,
          );
          cursor = next;
          if (keys.length) {
            await this.redis.del(...keys);
            removed += keys.length;
          }
        } while (cursor !== '0');
      } else {
        for (const k of Array.from(this.memory.keys())) {
          if (k.startsWith(prefix)) {
            this.memory.delete(k);
            removed++;
          }
        }
      }
    } catch {
      /* ignore */
    }
    return removed;
  }

  // ==================== 批量（embedding 缓存用）====================

  async mget<T = unknown>(keys: string[]): Promise<(T | null)[]> {
    if (!keys.length) return [];
    try {
      if (this.redis && this.redisReady) {
        const raws = await this.redis.mget(...keys);
        return raws.map((raw) => {
          if (raw == null) {
            this.misses++;
            return null;
          }
          this.hits++;
          try {
            return JSON.parse(raw) as T;
          } catch {
            return null;
          }
        });
      }
      return keys.map((k) => {
        const e = this.memory.get(k);
        if (!e || e.expireAt <= Date.now()) {
          if (e) this.memory.delete(k);
          this.misses++;
          return null;
        }
        this.hits++;
        try {
          return JSON.parse(e.value) as T;
        } catch {
          return null;
        }
      });
    } catch {
      this.misses += keys.length;
      return keys.map(() => null);
    }
  }

  async mset(
    entries: Array<{ key: string; value: unknown }>,
    ttlSeconds = 3600,
  ): Promise<void> {
    if (!entries.length) return;
    try {
      if (this.redis && this.redisReady) {
        const pipe = this.redis.pipeline();
        for (const { key, value } of entries) {
          pipe.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        }
        await pipe.exec();
        return;
      }
      for (const { key, value } of entries) {
        if (this.memory.size >= CacheService.MEMORY_MAX_ENTRIES) this.evictMemory();
        this.memory.set(key, {
          value: JSON.stringify(value),
          expireAt: Date.now() + ttlSeconds * 1000,
        });
      }
    } catch {
      /* ignore */
    }
  }

  /** 读穿透封装：命中直接返回，未命中执行 fn 并回填 */
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fn();
    if (fresh !== undefined && fresh !== null) {
      await this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  // ==================== 内部 ====================

  /** 先清过期，仍超限则丢弃最早写入的 10% */
  private evictMemory() {
    const now = Date.now();
    for (const [k, v] of this.memory) {
      if (v.expireAt <= now) this.memory.delete(k);
    }
    if (this.memory.size < CacheService.MEMORY_MAX_ENTRIES) return;
    const drop = Math.ceil(CacheService.MEMORY_MAX_ENTRIES * 0.1);
    let i = 0;
    for (const k of this.memory.keys()) {
      this.memory.delete(k);
      if (++i >= drop) break;
    }
  }
}
