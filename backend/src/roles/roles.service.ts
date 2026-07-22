import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.role.findMany({
      include: {
        _count: { select: { rolePermissions: true, userRoles: true } },
      },
      orderBy: { isBuiltin: 'desc' },
    });
  }
}