import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * 数据范围枚举：与 Prisma schema 中 UserOrganization.dataScope 对应
 */
export type DataScope = 'ALL' | 'ORG' | 'ORG_AND_CHILDREN' | 'SELF' | 'CUSTOM';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

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