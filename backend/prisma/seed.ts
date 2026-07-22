/**
 * Prisma Seed：初始化基础数据
 * - 根组织（"默认组织"）
 * - 内置角色：super_admin / admin / editor / viewer
 * - 全量权限码（菜单/按钮/API）
 * - 默认账号：admin / 123456
 * - admin 用户归属根组织 + super_admin 角色 + ALL 数据范围
 */
import { PrismaClient, DataScope, PermissionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// ============================================================
// 全量权限码定义
// ============================================================
const PERMISSIONS: Array<{
  code: string;
  name: string;
  type: PermissionType;
  parentCode?: string;
  sort: number;
}> = [
  // 用户管理
  { code: 'user', name: '用户管理', type: 'menu', sort: 1 },
  { code: 'user:list', name: '查看用户', type: 'api', parentCode: 'user', sort: 1 },
  { code: 'user:create', name: '创建用户', type: 'button', parentCode: 'user', sort: 2 },
  { code: 'user:edit', name: '编辑用户', type: 'button', parentCode: 'user', sort: 3 },
  { code: 'user:delete', name: '删除用户', type: 'button', parentCode: 'user', sort: 4 },
  { code: 'user:reset-password', name: '重置密码', type: 'button', parentCode: 'user', sort: 5 },

  // 组织管理
  { code: 'org', name: '组织管理', type: 'menu', sort: 2 },
  { code: 'org:list', name: '查看组织', type: 'api', parentCode: 'org', sort: 1 },
  { code: 'org:create', name: '创建组织', type: 'button', parentCode: 'org', sort: 2 },
  { code: 'org:edit', name: '编辑组织', type: 'button', parentCode: 'org', sort: 3 },
  { code: 'org:delete', name: '删除组织', type: 'button', parentCode: 'org', sort: 4 },

  // 角色管理
  { code: 'role', name: '角色管理', type: 'menu', sort: 3 },
  { code: 'role:list', name: '查看角色', type: 'api', parentCode: 'role', sort: 1 },
  { code: 'role:create', name: '创建角色', type: 'button', parentCode: 'role', sort: 2 },
  { code: 'role:edit', name: '编辑角色', type: 'button', parentCode: 'role', sort: 3 },
  { code: 'role:delete', name: '删除角色', type: 'button', parentCode: 'role', sort: 4 },
  { code: 'role:assign', name: '分配角色', type: 'button', parentCode: 'role', sort: 5 },

  // 智能体
  { code: 'agent', name: '智能体', type: 'menu', sort: 10 },
  { code: 'agent:list', name: '查看智能体', type: 'api', parentCode: 'agent', sort: 1 },
  { code: 'agent:create', name: '创建智能体', type: 'button', parentCode: 'agent', sort: 2 },
  { code: 'agent:edit', name: '编辑智能体', type: 'button', parentCode: 'agent', sort: 3 },
  { code: 'agent:delete', name: '删除智能体', type: 'button', parentCode: 'agent', sort: 4 },
  { code: 'agent:publish', name: '发布智能体', type: 'button', parentCode: 'agent', sort: 5 },
  { code: 'agent:run', name: '运行智能体', type: 'api', parentCode: 'agent', sort: 6 },

  // 工作流
  { code: 'workflow', name: '工作流', type: 'menu', sort: 11 },
  { code: 'workflow:list', name: '查看工作流', type: 'api', parentCode: 'workflow', sort: 1 },
  { code: 'workflow:create', name: '创建工作流', type: 'button', parentCode: 'workflow', sort: 2 },
  { code: 'workflow:edit', name: '编辑工作流', type: 'button', parentCode: 'workflow', sort: 3 },
  { code: 'workflow:run', name: '运行工作流', type: 'api', parentCode: 'workflow', sort: 4 },

  // 知识库
  { code: 'kb', name: '知识库', type: 'menu', sort: 20 },
  { code: 'kb:list', name: '查看知识库', type: 'api', parentCode: 'kb', sort: 1 },
  { code: 'kb:create', name: '创建知识库', type: 'button', parentCode: 'kb', sort: 2 },
  { code: 'kb:edit', name: '编辑知识库', type: 'button', parentCode: 'kb', sort: 3 },
  { code: 'kb:delete', name: '删除知识库', type: 'button', parentCode: 'kb', sort: 4 },
  { code: 'document:upload', name: '上传文档', type: 'button', parentCode: 'kb', sort: 5 },

  // Skills
  { code: 'skill', name: '技能管理', type: 'menu', sort: 30 },
  { code: 'skill:list', name: '查看技能', type: 'api', parentCode: 'skill', sort: 1 },
  { code: 'skill:create', name: '创建技能', type: 'button', parentCode: 'skill', sort: 2 },
  { code: 'skill:install', name: '安装技能', type: 'button', parentCode: 'skill', sort: 3 },

  // LLM Provider
  { code: 'provider', name: '模型配置', type: 'menu', sort: 40 },
  { code: 'provider:list', name: '查看模型', type: 'api', parentCode: 'provider', sort: 1 },
  { code: 'provider:create', name: '添加模型', type: 'button', parentCode: 'provider', sort: 2 },
  { code: 'provider:edit', name: '编辑模型', type: 'button', parentCode: 'provider', sort: 3 },

  // 执行记录
  { code: 'execution', name: '执行记录', type: 'menu', sort: 50 },
  { code: 'execution:list', name: '查看执行', type: 'api', parentCode: 'execution', sort: 1 },
];

// ============================================================
// 内置角色 + 默认权限分配
// ============================================================
const BUILTIN_ROLES = [
  {
    code: 'super_admin',
    name: '超级管理员',
    description: '拥有系统全部权限（不可删除）',
    permissionCodes: ['*'], // 占位：seed 时展开为全部权限
  },
  {
    code: 'admin',
    name: '管理员',
    description: '组织内管理员',
    permissionCodes: [
      'user', 'user:list', 'user:create', 'user:edit', 'user:reset-password',
      'org', 'org:list',
      'role', 'role:list',
      'agent', 'agent:list', 'agent:create', 'agent:edit', 'agent:delete', 'agent:publish', 'agent:run',
      'workflow', 'workflow:list', 'workflow:create', 'workflow:edit', 'workflow:run',
      'kb', 'kb:list', 'kb:create', 'kb:edit', 'kb:delete', 'document:upload',
      'skill', 'skill:list', 'skill:create', 'skill:install',
      'provider', 'provider:list', 'provider:create', 'provider:edit',
      'execution', 'execution:list',
    ],
  },
  {
    code: 'editor',
    name: '编辑者',
    description: '可创建/编辑智能体、文档',
    permissionCodes: [
      'agent', 'agent:list', 'agent:create', 'agent:edit', 'agent:run',
      'workflow', 'workflow:list', 'workflow:create', 'workflow:edit', 'workflow:run',
      'kb', 'kb:list', 'kb:create', 'kb:edit', 'document:upload',
      'skill', 'skill:list',
      'provider', 'provider:list',
      'execution', 'execution:list',
    ],
  },
  {
    code: 'viewer',
    name: '查看者',
    description: '只读访问',
    permissionCodes: [
      'agent', 'agent:list',
      'workflow', 'workflow:list',
      'kb', 'kb:list',
      'skill', 'skill:list',
      'provider', 'provider:list',
      'execution', 'execution:list',
    ],
  },
];

async function main() {
  console.log('🌱 开始 seed ...');

  // 1. 创建根组织
  console.log('  → 创建根组织');
  const rootOrg = await prisma.organization.upsert({
    where: { code: 'ROOT' },
    update: {},
    create: {
      code: 'ROOT',
      name: '默认组织',
      path: '/',
      level: 1,
      sort: 0,
      description: '系统初始化时创建的根组织',
    },
  });
  console.log(`    ✓ 根组织: ${rootOrg.name} (${rootOrg.id})`);

  // 2. 创建全量权限码
  console.log('  → 创建权限码');
  const codeToId = new Map<string, string>();

  // 第一遍：创建无 parent 的
  for (const p of PERMISSIONS.filter((x) => !x.parentCode)) {
    const created = await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, type: p.type, sort: p.sort },
      create: { code: p.code, name: p.name, type: p.type, sort: p.sort },
    });
    codeToId.set(p.code, created.id);
  }

  // 第二遍：创建有 parent 的
  for (const p of PERMISSIONS.filter((x) => x.parentCode)) {
    const parentId = codeToId.get(p.parentCode!);
    const created = await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, type: p.type, sort: p.sort, parentId },
      create: { code: p.code, name: p.name, type: p.type, sort: p.sort, parentId },
    });
    codeToId.set(p.code, created.id);
  }
  console.log(`    ✓ 创建 ${codeToId.size} 个权限码`);

  // 3. 创建内置角色 + 绑定权限
  console.log('  → 创建内置角色');
  const allPermIds = Array.from(codeToId.values());

  for (const r of BUILTIN_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isBuiltin: true },
      create: {
        code: r.code,
        name: r.name,
        description: r.description,
        isBuiltin: true,
      },
    });

    // 展开权限码列表
    const targetPermIds = r.permissionCodes[0] === '*'
      ? allPermIds
      : r.permissionCodes.map((c) => codeToId.get(c)).filter(Boolean) as string[];

    // 重建 RolePermission（先删后建，简单粗暴）
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: targetPermIds.map((pid) => ({ roleId: role.id, permissionId: pid })),
    });

    console.log(`    ✓ 角色 ${r.code}: ${targetPermIds.length} 个权限`);
  }

  // 4. 创建默认管理员账号
  console.log('  → 创建默认管理员账号');
  const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '123456';

  const adminUser = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      name: '系统管理员',
      email: 'admin@example.com',
      isSuperAdmin: true,
      mustChangePassword: true,
      status: 'active',
    },
  });

  // 5. 关联 admin → 根组织（ALL 数据范围）
  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId: adminUser.id,
        organizationId: rootOrg.id,
      },
    },
    update: { dataScope: DataScope.ALL, isPrimary: true },
    create: {
      userId: adminUser.id,
      organizationId: rootOrg.id,
      isPrimary: true,
      dataScope: DataScope.ALL,
    },
  });

  // 6. 关联 admin → super_admin 角色
  const superAdminRole = await prisma.role.findUnique({ where: { code: 'super_admin' } });
  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId_organizationId: {
          userId: adminUser.id,
          roleId: superAdminRole.id,
          organizationId: rootOrg.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: superAdminRole.id,
        organizationId: rootOrg.id,
      },
    });
  }

  console.log(`    ✓ 管理员账号: ${adminUsername} / ${adminPassword}`);
  console.log('🎉 Seed 完成！');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });