import { IsOptional, IsString } from 'class-validator';

export class RunWorkflowDto {
  @IsOptional()
  @IsString()
  input?: string;
}
