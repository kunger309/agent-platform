import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, IsNumber } from 'class-validator';

/** 检索测试 / 实际检索请求体 */
export class RetrieveDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  scoreThreshold?: number;
}
