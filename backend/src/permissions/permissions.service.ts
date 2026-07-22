import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree() {
    const all = await this.prisma.permission.findMany({
      orderBy: [{ type: 'asc' }, { sort: 'asc' }],
    });

    const menuTree = this.buildTree(all.filter((p) => p.type === 'menu'));
    const buttonList = all.filter((p) => p.type === 'button');
    const apiList = all.filter((p) => p.type === 'api');

    return { menuTree, buttonList, apiList };
  }

  private buildTree(items: any[], parentId: string | null = null): any[] {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => ({
        ...item,
        children: this.buildTree(items, item.id),
      }));
  }
}