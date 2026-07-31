/**
 * API 聚合入口
 *
 * 用法：import { listUsers, fetchAgents } from '@/api'
 *
 * 规范：
 * - 业务模块命名以资源复数为主（users / agents / providers / roles ...）
 * - 每个模块一个同名 .js 文件，使用 client.js 的 axios 实例
 * - index.js 只做 re-export，方便跨模块一次导入
 */
export * from './client';
export * from './auth';
export * from './users';
export * from './roles';
export * from './organizations';
export * from './permissions';
export * from './provider';
export * from './agent';
export * from './api-keys';
export * from './monitor';
export * from './dashboard';
