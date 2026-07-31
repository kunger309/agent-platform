import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { FieldPermissionItemDto } from './dto/set-field-permissions.dto';
import { RbacService } from '../rbac/rbac.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async findAll() {
    const roles = await this.prisma.role.findMany({
      include: {
        _count: { select: { rolePermissions: true, userRoles: true } },
        rolePermissions: { include: { permission: { select: { code: true } } } },
      },
      orderBy: { isBuiltin: 'desc' },
    });
    // 扁平化权限码，方便前端预勾选；并附上继承来源与「有效权限」（自身 + 祖先）
    const byId = new Map(roles.map((r) => [r.id, r]));
    const ownCodes = new Map(
      roles.map((r) => [r.id, r.rolePermissions.map((rp) => rp.permission.code)]),
    );

    const effectiveOf = (id: string): string[] => {
      const set = new Set<string>();
      let cur: string | null | undefined = id;
      let depth = 0;
      const seen = new Set<string>();
      while (cur && !seen.has(cur) && depth < 32) {
        seen.add(cur);
        (ownCodes.get(cur) || []).forEach((c) => set.add(c));
        cur = byId.get(cur)?.parentId ?? null;
        depth++;
      }
      return Array.from(set);
    };

    return roles.map((r) => ({
      ...r,
      permissionCodes: ownCodes.get(r.id) || [],
      // 继承后的完整权限（前端用于展示"实际生效"）
      effectivePermissionCodes: effectiveOf(r.id),
      parentCode: r.parentId ? byId.get(r.parentId)?.code ?? null : null,
      parentName: r.parentId ? byId.get(r.parentId)?.name ?? null : null,
    }));
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
        fieldPermissions: true,
        parent: { select: { id: true, code: true, name: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    const effectivePermissionCodes = await this.rbac.resolvePermissionCodes([id]);
    return {
      ...role,
      permissionCodes: role.rolePermissions.map((rp) => rp.permission.code),
      effectivePermissionCodes,
    };
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException('Role code already exists');
    }

    if (dto.parentId) {
      const parent = await this.prisma.role.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('父角色不存在');
    }

    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        dataScope: dto.dataScope ?? 'ORG',
        parentId: dto.parentId || null,
      },
    });

    if (dto.permissionCodes?.length) {
      await this.replacePermissions(role.id, dto.permissionCodes);
    }

    return this.findOne(role.id);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isBuiltin) {
      throw new ConflictException('Cannot edit a built-in role');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dataScope !== undefined) data.dataScope = dto.dataScope;
    if (dto.parentId !== undefined) {
      const parentId = dto.parentId || null;
      if (parentId) {
        const parent = await this.prisma.role.findUnique({ where: { id: parentId } });
        if (!parent) throw new BadRequestException('父角色不存在');
      }
      // 防止 A→B→A 这类继承环导致权限解析死循环
      await this.rbac.assertNoRoleCycle(id, parentId);
      data.parentId = parentId;
    }

    await this.prisma.role.update({ where: { id }, data });

    if (dto.permissionCodes !== undefined) {
      await this.replacePermissions(id, dto.permissionCodes);
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isBuiltin) {
      throw new ConflictException('Cannot delete a built-in role');
    }

    const child = await this.prisma.role.findFirst({ where: { parentId: id } });
    if (child) {
      throw new ConflictException(`该角色被「${child.name}」继承，请先解除继承关系`);
    }

    const userRoles = await this.prisma.userRole.findFirst({ where: { roleId: id } });
    if (userRoles) {
      throw new ConflictException('Cannot delete role that is assigned to users');
    }

    await this.prisma.role.delete({ where: { id } });
    return { id };
  }

  /** 替换角色的权限（先删后建） */
  async assignPermissions(id: string, permissionCodes: string[]) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');

    // 校验权限码都存在，过滤掉无效码（避免脏数据炸库）
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    const validCodes = new Set(perms.map((p) => p.code));
    const unknown = permissionCodes.filter((c) => !validCodes.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission codes: ${unknown.join(', ')}`);
    }

    await this.replacePermissions(id, permissionCodes);
    return this.findOne(id);
  }

  private async replacePermissions(roleId: string, permissionCodes: string[]) {
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true },
    });
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (perms.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      });
    }
  }

  // ==================== 字段级权限 ====================

  /**
   * 可做字段级管控的资源字典。
   * 只有在 Controller 上标注了 @MaskResource(resource) 的端点才会真正生效，
   * 这里的清单必须与代码里的标注保持一致，否则前端会配出「不生效的策略」。
   */
  listMaskableResources() {
    return [
      {
        resource: 'user',
        label: '用户',
        fields: [
          { field: 'email', label: '邮箱' },
          { field: 'name', label: '姓名' },
          { field: 'avatar', label: '头像' },
          { field: 'lastLoginAt', label: '最后登录时间' },
          { field: 'isSuperAdmin', label: '超管标记' },
        ],
      },
      {
        resource: 'apiKey',
        label: 'API Key',
        fields: [
          { field: 'maskedKey', label: '密钥片段' },
          { field: 'lastUsedAt', label: '最近使用时间' },
          { field: 'createdBy', label: '创建人' },
        ],
      },
    ];
  }

  async listFieldPermissions(roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return this.prisma.fieldPermission.findMany({
      where: { roleId },
      orderBy: [{ resource: 'asc' }, { field: 'asc' }],
    });
  }

  /** 全量替换该角色的字段级权限（与权限分配保持"先删后建"的一致语义） */
  async setFieldPermissions(roleId: string, items: FieldPermissionItemDto[]) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    // 同一 (resource, field) 去重，保留最后一条，避免唯一约束冲突
    const dedup = new Map<string, FieldPermissionItemDto>();
    for (const it of items || []) {
      dedup.set(`${it.resource}::${it.field}`, it);
    }

    await this.prisma.$transaction([
      this.prisma.fieldPermission.deleteMany({ where: { roleId } }),
      ...(dedup.size
        ? [
            this.prisma.fieldPermission.createMany({
              data: Array.from(dedup.values()).map((it) => ({
                roleId,
                resource: it.resource,
                field: it.field,
                access: it.access,
              })),
            }),
          ]
        : []),
    ]);

    return this.listFieldPermissions(roleId);
  }
}
