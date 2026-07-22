import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

    // 聚合权限码
    const permissionCodes = new Set<string>();
    user.userRoles.forEach((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        permissionCodes.add(rp.permission.code);
      });
    });

    const roles = user.userRoles.map((ur) => ur.role.code);
    const organizations = user.userOrganizations.map((uo) => ({
      id: uo.organizationId,
      name: uo.organization.name,
      dataScope: uo.dataScope,
      isPrimary: uo.isPrimary,
    }));

    const payload = {
      sub: user.id,
      username: user.username,
      isSuperAdmin: user.isSuperAdmin,
      roles,
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
}