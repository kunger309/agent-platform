import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const roles = await this.prisma.role.findMany({
      include: {
        _count: { select: { rolePermissions: true, userRoles: true } },
        rolePermissions: { include: { permission: { select: { code: true } } } },
      },
      orderBy: { isBuiltin: 'desc' },
    });
    // 扁平化权限码，方便前端预勾选
    return roles.map((r) => ({
      ...r,
      permissionCodes: r.rolePermissions.map((rp) => rp.permission.code),
    }));
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      ...role,
      permissionCodes: role.rolePermissions.map((rp) => rp.permission.code),
    };
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException('Role code already exists');
    }

    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        dataScope: dto.dataScope ?? 'ORG',
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
}
