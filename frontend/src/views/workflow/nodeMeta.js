/**
 * 工作流节点类型元信息：图标、配色、默认配置、摘要渲染。
 * 所有节点在 Vue Flow 中统一使用自定义组件 WorkflowNode 渲染，
 * 由 data.type 决定具体外观与配置表单。
 */
export const NODE_TYPES = [
  {
    type: 'llm',
    label: 'LLM 大模型',
    icon: 'MagicStick',
    color: '#7c3aed',
    desc: '调用大模型生成文本',
    defaultConfig: { promptTemplate: '{{input}}', systemPrompt: '', providerId: '', model: '' },
  },
  {
    type: 'answer',
    label: '回复',
    icon: 'Promotion',
    color: '#059669',
    desc: '输出工作流最终答案',
    defaultConfig: { template: '{{input}}' },
  },
  {
    type: 'condition',
    label: '条件分支',
    icon: 'Switch',
    color: '#d97706',
    desc: '按条件路由到 true / false 分支',
    defaultConfig: { variable: 'output', operator: 'contains', value: '' },
  },
  {
    type: 'tool',
    label: '工具 / 变换',
    icon: 'Tools',
    color: '#0891b2',
    desc: '对输入做模板变换，常用于格式化',
    defaultConfig: { template: '{{input}}' },
  },
  {
    type: 'http',
    label: 'HTTP 请求',
    icon: 'Connection',
    color: '#dc2626',
    desc: '调用外部 API',
    defaultConfig: { url: '', method: 'POST', headers: {}, bodyTemplate: '' },
  },
  {
    type: 'code',
    label: '代码',
    icon: 'Cpu',
    color: '#4f46e5',
    desc: '执行 JS 片段（return 即输出）',
    defaultConfig: { code: 'return input;' },
  },
  {
    type: 'kb',
    label: '知识库',
    icon: 'Collection',
    color: '#9333ea',
    desc: '混合检索（向量 + BM25 + RRF）',
    defaultConfig: { kbId: '', query: '{{input}}', topK: 5, scoreThreshold: 0 },
  },
];

export function getNodeMeta(type) {
  return NODE_TYPES.find((n) => n.type === type) || NODE_TYPES[0];
}

/** 生成一个节点的配置摘要，用于在画布节点卡片上展示 */
// 第三个参数 kbLookup: (kbId) => kbObject|null，可选（KB 节点会显示 KB 名称）
export function nodeSummary(type, config = {}, kbLookup) {
  switch (type) {
    case 'llm':
      return (config.promptTemplate || '').slice(0, 60) || '（未配置提示词）';
    case 'answer':
      return (config.template || '').slice(0, 60) || '{{input}}';
    case 'condition':
      return `${config.variable || 'output'} ${opLabel(config.operator)} ${config.value ?? ''}`;
    case 'tool':
      return (config.template || '').slice(0, 60) || '{{input}}';
    case 'http':
      return `${(config.method || 'POST').toUpperCase()} ${config.url || '（未配置 URL）'}`;
    case 'code':
      return (config.code || '').split('\n')[0].slice(0, 60) || 'return input;';
    case 'kb': {
      const kb = kbLookup?.(config.kbId);
      const topK = config.topK ?? 5;
      return `KB: ${kb ? kb.name : (config.kbId || '未选')} · topK=${topK}`;
    }
    default:
      return '';
  }
}

export function opLabel(op) {
  return {
    contains: '包含',
    not_contains: '不包含',
    equals: '等于',
    not_equals: '不等于',
    regex: '正则',
    truthy: '为真',
    falsy: '为假',
  }[op] || op;
}
