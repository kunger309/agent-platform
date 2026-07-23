import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

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

  async create(dto: CreateOrganizationDto) {
    // 编码唯一性校验
    const existing = await this.prisma.organization.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Organization code already exists');
    }

    let level = 1;
    let path = '/';
    if (dto.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new NotFoundException('Parent organization not found');
      level = parent.level + 1;
      path = `${parent.path}${parent.id}/`;
    }

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        code: dto.code,
        parentId: dto.parentId ?? null,
        level,
        path,
        sort: dto.sort ?? 0,
        status: dto.status ?? 'active',
        description: dto.description,
      },
    });
    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    const existing = await this.prisma.organization.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Organization not found');

    // 不允许把组织挂到自己或自己的子孙下（环检测）
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Cannot set organization as its own parent');
      }
      const pid = dto.parentId;
      const parent = await this.prisma.organization.findUnique({
        where: { id: pid },
      });
      if (!parent) throw new NotFoundException('Parent organization not found');

      // 父不能是自己子孙：把所有子孙 id 拿出来比对
      const all = await this.findAll();
      const descendants: string[] = [];
      const collect = (pid: string) => {
        for (const it of all) {
          if (it.parentId === pid) {
            descendants.push(it.id);
            collect(it.id);
          }
        }
      };
      collect(id);
      if (descendants.includes(dto.parentId)) {
        throw new BadRequestException('Cannot move organization under its own descendant');
      }

      const level = parent.level + 1;
      const path = `${parent.path}${parent.id}/`;
      // 同步子孙的 level / path
      await this.rebuildSubtree(id, level, path);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.sort !== undefined) data.sort = dto.sort;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) {
      data.parentId = dto.parentId;
      const pid2 = dto.parentId;
      const parent = pid2
        ? await this.prisma.organization.findUnique({ where: { id: pid2 } })
        : null;
      data.level = parent ? parent.level + 1 : 1;
      data.path = parent ? `${parent.path}${parent.id}/` : '/';
    }

    return this.prisma.organization.update({ where: { id }, data });
  }

  /** 重算子树所有节点的 level / path */
  private async rebuildSubtree(rootId: string, rootLevel: number, rootPath: string) {
    const all = await this.prisma.organization.findMany({
      // 注意：子树重算必须覆盖所有状态，禁用节点也参与（否则改父级后禁用子树的 path/level 不同步 → 脏数据）
      select: { id: true, parentId: true },
    });
    const childrenOf = (pid: string) =>
      all.filter((x) => x.parentId === pid).map((x) => x.id);

    const walk = async (nodeId: string, level: number, path: string) => {
      await this.prisma.organization.update({
        where: { id: nodeId },
        data: { level, path },
      });
      for (const childId of childrenOf(nodeId)) {
        walk(childId, level + 1, `${path}${nodeId}/`);
      }
    };
    await walk(rootId, rootLevel, rootPath);
  }

  async remove(id: string) {
    const existing = await this.prisma.organization.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Organization not found');
    if (existing.code === 'ROOT') {
      throw new ConflictException('Cannot delete root organization');
    }

    const children = await this.prisma.organization.findMany({ where: { parentId: id } });
    if (children.length > 0) {
      throw new ConflictException('Cannot delete organization with child organizations');
    }

    const linkedUsers = await this.prisma.userOrganization.findFirst({
      where: { organizationId: id },
    });
    if (linkedUsers) {
      throw new ConflictException('Cannot delete organization with assigned users');
    }

    await this.prisma.organization.delete({ where: { id } });
    return { id };
  }
}
