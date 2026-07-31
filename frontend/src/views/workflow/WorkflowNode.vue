<template>
  <div class="wf-node" :class="{ selected }" :style="{ '--node-color': meta.color }">
    <!-- 左侧输入句柄（除起始节点外都可有入边） -->
    <Handle type="target" :position="Position.Left" />

    <div class="wf-node__head">
      <el-icon class="wf-node__icon" :style="{ color: meta.color }">
        <component :is="IconComp" />
      </el-icon>
      <span class="wf-node__title">{{ meta.label }}</span>
      <span v-if="data.label" class="wf-node__name">{{ data.label }}</span>
    </div>

    <div class="wf-node__body">{{ summary }}</div>

    <!-- 条件节点：两个输出句柄 true/false -->
    <template v-if="data.nodeType === 'condition'">
      <Handle
        id="true"
        type="source"
        :position="Position.Right"
        :style="{ top: '35%', background: '#059669' }"
      />
      <Handle
        id="false"
        type="source"
        :position="Position.Right"
        :style="{ top: '75%', background: '#dc2626' }"
      />
      <span class="wf-edge-label wf-edge-label--true">真</span>
      <span class="wf-edge-label wf-edge-label--false">假</span>
    </template>
    <!-- 其它节点：一个输出句柄 -->
    <Handle v-else type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import * as ElIcons from '@element-plus/icons-vue';
import { getNodeMeta, nodeSummary } from './nodeMeta';

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

// 父组件注入 KB / 技能列表查找器（用于节点摘要显示名称）
const kbLookup = inject('wfKbLookup', null);
const skillLookup = inject('wfSkillLookup', null);

const meta = computed(() => getNodeMeta(props.data.nodeType));
const IconComp = computed(() => ElIcons[meta.value.icon] || ElIcons.Document);
const summary = computed(() =>
  nodeSummary(props.data.nodeType, props.data.config || {}, kbLookup, skillLookup),
);
</script>

<style scoped>
.wf-node {
  min-width: 180px;
  max-width: 240px;
  background: var(--surface);
  border: 1px solid var(--border-base);
  border-left: 4px solid var(--node-color);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-size: 12px;
  overflow: hidden;
}
.wf-node.selected {
  box-shadow: 0 0 0 2px var(--node-color);
}
.wf-node__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface-muted);
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.wf-node__icon { font-size: 16px; }
.wf-node__title { font-weight: 600; color: var(--text-primary); }
.wf-node__name {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-node__body {
  padding: 8px 10px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  min-height: 20px;
  word-break: break-all;
  max-height: 56px;
  overflow: hidden;
}
.wf-edge-label {
  position: absolute;
  right: -26px;
  font-size: 10px;
  color: var(--text-inverse);
  padding: 0 4px;
  border-radius: 3px;
}
.wf-edge-label--true { top: 30%; background: var(--el-color-success); }
.wf-edge-label--false { top: 70%; background: var(--el-color-danger); }
</style>
