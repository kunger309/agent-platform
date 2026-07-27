import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { RbacModule } from './rbac/rbac.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';
import { AgentsModule } from './agents/agents.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { InternalModule } from './internal/internal.module';

@Module({
  imports: [
    // 全局配置（.env）
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // 基础设施
    DatabaseModule,
    CommonModule,

    // 业务模块
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RolesModule,
    PermissionsModule,
    RbacModule,
    LlmModule,
    AgentsModule,
    WorkflowsModule,
    InternalModule,

    // 系统
    HealthModule,
  ],
})
export class AppModule {}