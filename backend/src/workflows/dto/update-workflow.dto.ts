import { IsString, IsOptional, IsObject, IsIn } from 'class-validator';

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @IsOptional()
  @IsObject()
  graphJson?: Record<string, any>;

  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
}
