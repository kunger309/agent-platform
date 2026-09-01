import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ResetPasswordDto } from './dto/update-user.dto';

/**
 * 越权防护：仅超级管理员可修改/删除超级管理员账号。
 *
 * 背景：update/remove 接口只校验「调用者是否持有 user:edit / user:delete 权限码」，
 * 不校验「被操作对象是谁」。若普通 admin / editor / 自定义角色也能 PATCH 一个
 * isSuperAdmin=true 的账号（例如把它的 roleCodes 从 super_admin 改成 viewer），
 * 该超管会瞬间失权、且无需 DB 介入无法回滚——属高危自残漏洞。
 * 故在此按「对象维度」再锁一层：被操作对象是超管且操作者不是超管 → 拒绝。
 */
function assertCanModifySuperAdmin(target: { isSuperAdmin?: boolean }, operator: any) {
  if (target.isSuperAdmin && !operator?.isSuperAdmin) {
    throw new ForbiddenException('仅超级管理员可修改超级管理员账号');
  }
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async findAll(currentUser: any, query: { organizationId?: string } = {}) {
    const where: any = await this.rbac.buildDataScopeFilter(currentUser, 'user');

    // 按组织过滤：选中组织 + 其所有子孙组织（用 path 前缀匹配，根组织用 id 兜底）
    if (query.organizationId) {
      const orgs = await this.prisma.organization.findMany({
        where: {
          OR: [
            { id: query.organizationId },
            { path: { contains: `/${query.organizationId}/` } },
          ],
        },
        select: { id: true },
      });
      const orgIds = orgs.map((o) => o.id);
      const uos = await this.prisma.userOrganization.findMany({
        where: { organizationId: { in: orgIds } },
        select: { userId: true },
      });
      const userIds = Array.from(new Set(uos.map((u) => u.userId)));
      where.id = { in: userIds };
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatar: true,
        status: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: { select: { role: { select: { code: true, name: true } } } },
        userOrganizations: {
          select: {
            isPrimary: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 扁平化角色为字符串数组（前端预期 row.roles = ['admin', ...]）
    // 同时挂上 organizations（含主组织标记）
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      status: u.status,
      isSuperAdmin: u.isSuperAdmin,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.userRoles.map((ur) => ur.role.code),
      roleNames: u.userRoles.map((ur) => ur.role.name),
      organizations: u.userOrganizations.map((uo) => ({
        id: uo.organization.id,
        name: uo.organization.name,
        isPrimary: uo.isPrimary,
      })),
    }));
  }

  async create(dto: CreateUserDto, currentUser: any) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        name: dto.name,
        email: dto.email === '' ? null : dto.email, // 空串规范化成 null
        status: dto.status ?? 'active',
      },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });

    // 绑定角色（roleCodes → 通过 code 查到 role.id，写 user_role）
    if (dto.roleCodes && dto.roleCodes.length > 0) {
      const roles = await this.prisma.role.findMany({
        where: { code: { in: dto.roleCodes } },
        select: { id: true, code: true },
      });
      if (roles.length > 0) {
        await this.prisma.userRole.createMany({
          data: roles.map((r) => ({ userId: user.id, roleId: r.id })),
        });
      }
      void currentUser; // 预留：未来记 audit
    }

    // 绑定主组织（organizationId → 写 user_organization，isPrimary=true）
    if (dto.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (org) {
        await this.prisma.userOrganization.create({
          data: {
            userId: user.id,
            organizationId: org.id,
            isPrimary: true,
            dataScope: 'ORG_AND_CHILDREN',
          },
        });
      }
    }

    return this.findOne(user.id);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatar: true,
        status: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: { select: { role: { select: { code: true, name: true } } } },
        userOrganizations: {
          select: {
            isPrimary: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      ...user,
      roles: user.userRoles.map((ur) => ur.role.code),
      roleNames: user.userRoles.map((ur) => ur.role.name),
      organizations: user.userOrganizations.map((uo) => ({
        id: uo.organization.id,
        name: uo.organization.name,
        isPrimary: uo.isPrimary,
      })),
    };
  }

  async update(id: string, dto: UpdateUserDto, currentUser: any) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    assertCanModifySuperAdmin(existing, currentUser);
    if (existing.username === 'admin' && dto.status === 'disabled') {
      throw new ConflictException('Cannot disable built-in admin');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email === '' ? null : dto.email; // 空串规范化成 null，避免 @unique 冲突
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.status !== undefined) data.status = dto.status;

    // 角色替换：删旧 → 插新
    if (dto.roleCodes !== undefined) {
      const roles = await this.prisma.role.findMany({
        where: { code: { in: dto.roleCodes } },
        select: { id: true },
      });
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      if (roles.length > 0) {
        await this.prisma.userRole.createMany({
          data: roles.map((r) => ({ userId: id, roleId: r.id })),
        });
      }
      void currentUser; // 预留：未来记 audit
    }

    // 组织绑定：替换主组织（先清旧，再按传入值建新；传 null/空 表示解绑）
    if (dto.organizationId !== undefined) {
      await this.prisma.userOrganization.deleteMany({ where: { userId: id } });
      if (dto.organizationId) {
        const org = await this.prisma.organization.findUnique({
          where: { id: dto.organizationId },
        });
        if (org) {
          await this.prisma.userOrganization.create({
            data: {
              userId: id,
              organizationId: org.id,
              isPrimary: true,
              dataScope: 'ORG_AND_CHILDREN',
            },
          });
        }
      }
    }

    await this.prisma.user.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string, currentUser: any) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    assertCanModifySuperAdmin(existing, currentUser);
    if (existing.username === 'admin') {
      throw new ConflictException('Cannot delete built-in admin');
    }
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    return { id };
  }
}