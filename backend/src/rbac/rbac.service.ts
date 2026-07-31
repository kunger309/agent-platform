import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * 数据范围枚举：与 Prisma schema 中 UserOrganization.dataScope 对应
 */
export type DataScope = 'ALL' | 'ORG' | 'ORG_AND_CHILDREN' | 'SELF' | 'CUSTOM';

/** 字段级权限策略 */
export type FieldAccess = 'visible' | 'masked' | 'hidden';

export interface FieldPolicy {
  resource: string;
  field: string;
  access: FieldAccess;
}

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 角色继承 ====================

  /**
   * 展开角色继承链：给定一组角色 id，返回其自身 + 所有祖先角色 id。
   *
   * 语义：子角色自动拥有父角色的全部权限（权限并集，只增不减），
   * 这样"部门主管 = 编辑者 + 审批权"这类模型无需重复勾选。
   */
  async expandRoleIds(roleIds: string[]): Promise<string[]> {
    if (!roleIds?.length) return [];

    const all = await this.prisma.role.findMany({
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(all.map((r) => [r.id, r.parentId]));

    const result = new Set<string>();
    for (const start of roleIds) {
      let cur: string | null | undefined = start;
      // 深度上限兜底，即使库里存在脏数据成环也不会死循环
      let depth = 0;
      while (cur && !result.has(cur) && depth < 32) {
        result.add(cur);
        cur = parentOf.get(cur) ?? null;
        depth++;
      }
    }
    return Array.from(result);
  }

  /**
   * 解析角色（含继承）对应的权限码集合。
   * 登录签发 JWT 时调用，保证 token 里的 permissionCodes 已含继承结果。
   */
  async resolvePermissionCodes(roleIds: string[]): Promise<string[]> {
    const expanded = await this.expandRoleIds(roleIds);
    if (!expanded.length) return [];

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: expanded } },
      select: { permission: { select: { code: true } } },
    });
    return Array.from(new Set(rows.map((r) => r.permission.code)));
  }

  /**
   * 设置角色的父角色前必须校验：不能指向自己，也不能形成环。
   */
  async assertNoRoleCycle(roleId: string, parentId: string | null) {
    if (!parentId) return;
    if (parentId === roleId) {
      throw new BadRequestException('父角色不能是自己');
    }
    const ancestors = await this.expandRoleIds([parentId]);
    if (ancestors.includes(roleId)) {
      throw new BadRequestException('角色继承不能成环');
    }
  }

  // ==================== 字段级权限 ====================

  /**
   * 取某组角色（含继承）在某资源上的字段策略。
   * 多角色冲突时取**最宽松**：visible > masked > hidden，
   * 与"权限并集"的整体语义保持一致。
   */
  async resolveFieldPolicies(
    roleIds: string[],
    resource: string,
  ): Promise<Map<string, FieldAccess>> {
    const map = new Map<string, FieldAccess>();
    const expanded = await this.expandRoleIds(roleIds);
    if (!expanded.length) return map;

    const rows = await this.prisma.fieldPermission.findMany({
      where: { roleId: { in: expanded }, resource },
      select: { field: true, access: true },
    });

    const rank: Record<string, number> = { hidden: 0, masked: 1, visible: 2 };
    for (const r of rows) {
      const cur = map.get(r.field);
      const next = (r.access as FieldAccess) || 'masked';
      if (!cur || rank[next] > rank[cur]) map.set(r.field, next);
    }
    return map;
  }

  /**
   * 按字段策略处理返回数据（原地生成副本，不改入参）。
   * - hidden：删除该字段
   * - masked：按字符串长度做保留首尾的掩码
   * - visible / 未配置：原样返回
   */
  applyFieldPolicies<T>(data: T, policies: Map<string, FieldAccess>): T {
    if (!policies.size || data == null) return data;

    const maskOne = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(maskOne);
      if (!obj || typeof obj !== 'object') return obj;

      const copy: any = { ...obj };
      for (const [field, access] of policies) {
        if (!(field in copy)) continue;
        if (access === 'hidden') delete copy[field];
        else if (access === 'masked') copy[field] = this.maskValue(copy[field]);
      }
      // 常见分页包装：{ items: [...] } / { list: [...] }
      if (Array.isArray(copy.items)) copy.items = copy.items.map(maskOne);
      if (Array.isArray(copy.list)) copy.list = copy.list.map(maskOne);
      return copy;
    };

    return maskOne(data);
  }

  private maskValue(v: any): any {
    if (v == null) return v;
    const s = String(v);
    if (!s) return s;
    // 邮箱：保留首字符与域名
    if (s.includes('@')) {
      const [name, domain] = s.split('@');
      return `${name.slice(0, 1)}***@${domain}`;
    }
    if (s.length <= 4) return '****';
    return `${s.slice(0, 2)}****${s.slice(-2)}`;
  }

  /**
   * 检查用户是否拥有指定权限码
   * - super_admin 永远返回 true
   */
  hasPermission(user: any, code: string): boolean {
    if (user?.isSuperAdmin) return true;
    return (user?.permissionCodes ?? []).includes(code);
  }

  /**
   * 检查用户是否拥有任一权限码
   */
  hasAnyPermission(user: any, codes: string[]): boolean {
    if (user?.isSuperAdmin) return true;
    return codes.some((c) => (user?.permissionCodes ?? []).includes(c));
  }

  /**
   * 为 Prisma 查询构造数据范围 WHERE 条件
   * @param currentUser JWT 解码后的 user 对象
   * @param resource 资源类型，用于决定字段映射（如 'user' → creatorId, 'agent' → organizationId）
   */
  async buildDataScopeFilter(currentUser: any, resource: string): Promise<any> {
    if (!currentUser) return { id: '__never__' }; // 未登录返回空

    if (currentUser.isSuperAdmin) return {}; // 超管无限制

    // 获取当前用户在当前组织的数据范围
    const uo = currentUser.organizations?.find(
      (o: any) => o.id === currentUser.currentOrgId,
    );
    const scope: DataScope = (uo?.dataScope as DataScope) ?? 'SELF';

    const orgIds = await this.resolveOrgIds(currentUser, scope);

    // 根据 resource 决定过滤字段
    switch (resource) {
      case 'user':
        if (scope === 'SELF') return { id: currentUser.userId };
        return {};

      case 'agent':
      case 'knowledgeBase':
      case 'llmProvider':
      case 'skill':
      case 'document':
      case 'conversation':
      case 'workflow':
      case 'execution':
        if (scope === 'SELF') {
          return { creatorId: currentUser.userId };
        }
        if (orgIds === null) return {};
        return { organizationId: { in: orgIds } };

      default:
        return {};
    }
  }

  /**
   * 解析数据范围对应的组织 ID 集合
   * - null 表示无限制（ALL）
   */
  private async resolveOrgIds(currentUser: any, scope: DataScope): Promise<string[] | null> {
    switch (scope) {
      case 'ALL':
        return null;

      case 'ORG':
        return currentUser.currentOrgId ? [currentUser.currentOrgId] : [];

      case 'ORG_AND_CHILDREN': {
        if (!currentUser.currentOrgId) return [];
        // 取所有后代组织
        const all = await this.prisma.organization.findMany({
          where: { status: 'active' },
          select: { id: true, parentId: true, path: true },
        });
        const result: string[] = [currentUser.currentOrgId];
        const collect = (parentId: string) => {
          all
            .filter((o) => o.parentId === parentId)
            .forEach((child) => {
              result.push(child.id);
              collect(child.id);
            });
        };
        collect(currentUser.currentOrgId);
        return result;
      }

      case 'SELF':
        return [];

      case 'CUSTOM':
        // 简化实现：等同 ORG，未来扩展
        return currentUser.currentOrgId ? [currentUser.currentOrgId] : [];

      default:
        return [];
    }
  }
}