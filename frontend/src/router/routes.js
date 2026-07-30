/**
 * 路由表
 * meta 配置说明：
 *   - requiresAuth: 是否需要登录
 *   - permission: 需要的权限码（单个）
 *   - permissionAny: 多个权限码，满足任一即可
 *   - layout: 'main' | 'blank'
 *   - title: 菜单标题（用于侧栏）
 *   - icon: 菜单图标
 *   - hideInMenu: 是否在侧栏隐藏
 */
const routes = [
  // ===== 公开路由（无需登录）=====
  {
    path: '/login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { layout: 'blank', title: '登录', hideInMenu: true },
  },

  // ===== 受保护路由（需登录）=====
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    component: () => import('@/views/dashboard/Index.vue'),
    meta: { requiresAuth: true, title: '工作台', icon: 'House' },
  },

  // 管理后台
  {
    path: '/admin',
    component: () => import('@/layouts/RouterView.vue'),
    meta: { requiresAuth: true, title: '系统管理', icon: 'Setting' },
    children: [
      {
        path: 'users',
        component: () => import('@/views/admin/users/UserList.vue'),
        meta: { requiresAuth: true, permission: 'user:list', title: '用户管理', icon: 'User' },
      },
      {
        path: 'organizations',
        component: () => import('@/views/admin/organizations/OrgTree.vue'),
        meta: { requiresAuth: true, permission: 'org:list', title: '组织管理', icon: 'OfficeBuilding' },
      },
      {
        path: 'roles',
        component: () => import('@/views/admin/roles/RoleList.vue'),
        meta: { requiresAuth: true, permission: 'role:list', title: '角色管理', icon: 'UserFilled' },
      },
    ],
  },

  // 聊天
  {
    path: '/chat',
    component: () => import('@/views/chat/Chat.vue'),
    meta: { requiresAuth: true, permission: 'agent:run', title: '智能对话', icon: 'ChatDotRound' },
  },

  // 智能体
  {
    path: '/agents',
    component: () => import('@/views/agents/AgentList.vue'),
    meta: { requiresAuth: true, permission: 'agent:list', title: '智能体', icon: 'MagicStick' },
  },
  {
    path: '/agents/:id/debug',
    component: () => import('@/views/agents/AgentDebug.vue'),
    meta: { requiresAuth: true, permission: 'agent:run', title: '调试对话', hideInMenu: true },
  },

  // 模型配置
  {
    path: '/providers',
    component: () => import('@/views/providers/ProviderList.vue'),
    meta: { requiresAuth: true, permission: 'provider:list', title: '模型配置', icon: 'Connection' },
  },

  // 知识库（RAG）
  {
    path: '/knowledge-bases',
    component: () => import('@/views/knowledge-bases/KBList.vue'),
    meta: { requiresAuth: true, permission: 'kb:list', title: '知识库', icon: 'Collection' },
  },

  // 技能市场（Skills 工具市场）
  {
    path: '/skills',
    component: () => import('@/layouts/RouterView.vue'), // 父级聚合 children
    meta: { requiresAuth: true, permission: 'skill:list', title: '技能市场', icon: 'Cpu' },
    children: [
      {
        path: '',
        component: () => import('@/views/skills/SkillList.vue'),
        meta: { requiresAuth: true, permission: 'skill:list', title: '技能列表' },
      },
      {
        path: 'invocations',
        component: () => import('@/views/tools/ToolInvocationList.vue'),
        meta: { requiresAuth: true, permission: 'execution:list', title: '调用记录' },
      },
    ],
  },
  {
    path: '/knowledge-bases/:id',
    component: () => import('@/views/knowledge-bases/KBDetail.vue'),
    meta: { requiresAuth: true, permission: 'kb:list', title: '知识库详情', hideInMenu: true },
  },

  // 工作流（LangGraph 可视化编排）
  {
    path: '/workflows',
    component: () => import('@/views/workflow/WorkflowList.vue'),
    meta: { requiresAuth: true, permission: 'workflow:list', title: '工作流', icon: 'Share' },
  },
  {
    path: '/workflows/:id/edit',
    component: () => import('@/views/workflow/WorkflowEditor.vue'),
    meta: { requiresAuth: true, permission: 'workflow:edit', title: '编排工作流', hideInMenu: true },
  },
  {
    path: '/workflows/:id/debug',
    component: () => import('@/views/workflow/WorkflowDebug.vue'),
    meta: { requiresAuth: true, permission: 'workflow:run', title: '调试工作流', hideInMenu: true },
  },

  // 个人中心
  {
    path: '/profile',
    component: () => import('@/views/profile/Profile.vue'),
    meta: { requiresAuth: true, title: '个人中心', hideInMenu: true },
  },

  // 403 / 404
  {
    path: '/403',
    component: () => import('@/views/errors/Forbidden.vue'),
    meta: { layout: 'blank', title: '无权限', hideInMenu: true },
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/errors/NotFound.vue'),
    meta: { layout: 'blank', title: '404', hideInMenu: true },
  },
];

export default routes;