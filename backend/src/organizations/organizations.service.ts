import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.organization.findMany({
      where: { status: 'active' },
      orderBy: [{ level: 'asc' }, { sort: 'asc' }],
    });
  }

  async findTree() {
    const all = await this.findAll();
    return this.buildTree(all, null);
  }

  private buildTree(items: any[], parentId: string | null): any[] {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => ({
        ...item,
        children: this.buildTree(items, item.id),
      }));
  }
}