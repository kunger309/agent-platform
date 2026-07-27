import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

/**
 * 工作流 HTTP 节点调用的只读 SQL 查询请求体。
 * 仅做最小校验；真正的安全性由 SqlService 的白名单 + IP Guard 保证。
 */
export class SqlQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'sql 不能为空' })
  @MinLength(2, { message: 'sql 至少 2 个字符' })
  @MaxLength(2000, { message: 'sql 不能超过 2000 字符' })
  sql!: string;
}