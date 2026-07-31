import { SetMetadata } from '@nestjs/common';

export const MASK_RESOURCE_KEY = 'maskResource';

/**
 * 标记该端点返回的数据属于某"资源"，交由 FieldMaskInterceptor
 * 按当前用户角色的字段级权限做隐藏 / 脱敏。
 *
 * 例：@MaskResource('user') → 查 field_permissions 中 resource='user' 的规则
 */
export const MaskResource = (resource: string) =>
  SetMetadata(MASK_RESOURCE_KEY, resource);
