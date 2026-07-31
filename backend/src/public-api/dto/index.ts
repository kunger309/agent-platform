import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PublicChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  message: string;

  /** 续接已有会话；不传则新建 */
  @IsOptional()
  @IsString()
  conversationId?: string;

  /** true = SSE 流式；默认 false（一次性返回完整 JSON） */
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class PublicRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  input?: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class PublicSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}
