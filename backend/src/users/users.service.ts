import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ResetPasswordDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async findAll(currentUser: any) {
    const where = await this.rbac.buildDataScopeFilter(currentUser, 'user');
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
      },
      orderBy: { createdAt: 'desc' },
    });
    // 扁平化角色为字符串数组（前端预期 row.roles = ['admin', ...]）
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
        email: dto.email,
        status: 'active',
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

    return user;
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
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      ...user,
      roles: user.userRoles.map((ur) => ur.role.code),
      roleNames: user.userRoles.map((ur) => ur.role.name),
    };
  }

  async update(id: string, dto: UpdateUserDto, currentUser: any) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.username === 'admin' && dto.status === 'disabled') {
      throw new ConflictException('Cannot disable built-in admin');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
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

    await this.prisma.user.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');
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