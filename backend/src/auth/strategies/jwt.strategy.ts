import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  username: string;
  name?: string;
  email?: string;
  avatar?: string;
  isSuperAdmin: boolean;
  roles: string[];
  permissionCodes: string[];
  organizations: Array<{ id: string; name: string; dataScope: string; isPrimary: boolean }>;
  currentOrgId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // 每次请求都校验用户是否仍然 active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true },
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User is no longer active');
    }

    return {
      userId: payload.sub,
      username: payload.username,
      name: payload.name,
      email: payload.email,
      avatar: payload.avatar,
      isSuperAdmin: payload.isSuperAdmin,
      roles: payload.roles,
      permissionCodes: payload.permissionCodes,
      organizations: payload.organizations,
      currentOrgId: payload.currentOrgId,
    };
  }
}