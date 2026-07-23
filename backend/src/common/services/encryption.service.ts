import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * API Key 加密服务
 * - 算法：AES-256-GCM
 * - 密钥：环境变量 ENCRYPTION_KEY（32 字节 hex）
 * - 输出格式：base64(iv | authTag | ciphertext)
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private key: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const hex = this.config.get<string>('ENCRYPTION_KEY');
    if (!hex || hex.length !== 64) {
      throw new Error(
        'ENCRYPTION_KEY 缺失或长度不对（应为 32 字节 hex，即 64 字符）',
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  /** 加密明文，返回 base64 字符串 */
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  /** 解密 base64 字符串，返回明文 */
  decrypt(encoded: string): string {
    if (!encoded) return encoded;
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }

  /** 仅显示 API Key 末尾 4 位 */
  mask(key: string): string {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${'*'.repeat(Math.max(8, key.length - 4))}${key.slice(-4)}`;
  }
}