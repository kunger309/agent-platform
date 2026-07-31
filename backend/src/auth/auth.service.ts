import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        userOrganizations: {
          include: {
            organization: true,
          },
        },
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User is disabled');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    // 聚合权限码（直接绑定的角色）
    const permissionCodes = new Set<string>();
    user.userRoles.forEach((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        permissionCodes.add(rp.permission.code);
      });
    });

    // 角色继承：把父角色（及祖先）的权限一并并入
    const inherited = await this.rbac.resolvePermissionCodes(
      user.userRoles.map((ur) => ur.roleId),
    );
    inherited.forEach((c) => permissionCodes.add(c));

    const roles = user.userRoles.map((ur) => ur.role.code);
    // 字段级权限依赖角色 id，放进 token 便于后续无需再查库
    const roleIds = user.userRoles.map((ur) => ur.roleId);
    const organizations = user.userOrganizations.map((uo) => ({
      id: uo.organizationId,
      name: uo.organization.name,
      dataScope: uo.dataScope,
      isPrimary: uo.isPrimary,
    }));

    const payload = {
      sub: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      isSuperAdmin: user.isSuperAdmin,
      roles,
      roleIds,
      permissionCodes: Array.from(permissionCodes),
      organizations,
      currentOrgId: organizations.find((o) => o.isPrimary)?.id ?? organizations[0]?.id,
    };

    const accessToken = await this.jwt.signAsync(payload);

    // 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          isSuperAdmin: user.isSuperAdmin,
          mustChangePassword: user.mustChangePassword,
          roles,
          permissionCodes: Array.from(permissionCodes),
          organizations,
          currentOrgId: payload.currentOrgId,
        },
      },
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (!oldPassword || !newPassword) {
      throw new BadRequestException('Old and new password are required');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
  }
}