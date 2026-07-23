<script setup>
import { ref, computed } from 'vue'
import { renderMarkdown } from '@/utils/markdown.js'

const props = defineProps({
  content: { type: String, default: '' },
  expanded: { type: Boolean, default: false },
  streaming: { type: Boolean, default: true },
})

const isExpanded = ref(props.expanded)

const displayedContent = computed(() => props.content || '')

function toggle() {
  isExpanded.value = !isExpanded.value
}

const rendered = computed(() => renderMarkdown(displayedContent.value))
</script>

<template>
  <div class="think-block" :class="{ streaming: props.streaming && !isExpanded }">
    <div class="think-header" @click="toggle">
      <el-icon class="chev" :class="{ open: isExpanded }"><ArrowRight /></el-icon>
      <el-icon class="ico"><MagicStick /></el-icon>
      <span class="title">思考过程</span>
      <span class="hint">{{ isExpanded ? '收起' : '展开' }}<template v-if="displayedContent.length">（{{ displayedContent.length }} 字）</template></span>
      <span v-if="props.streaming" class="live">● 进行中</span>
    </div>

    <div v-show="isExpanded" class="think-body">
      <!-- 流式进行中且无内容：打字光标 -->
      <div v-if="props.streaming && !displayedContent" class="typing">
        <span class="dot-bar"><i></i><i></i><i></i></span>
        正在思考…
      </div>
      <div v-else class="think-md" v-html="rendered"></div>
      <!-- 流式尾巴光标 -->
      <span v-if="props.streaming && displayedContent" class="cursor">▍</span>
    </div>
  </div>
</template>

<style scoped>
.think-block {
  background: #f7f5ff;
  border: 1px solid #e6def8;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
}
.think-block.streaming {
  border-color: #d6c8f0;
  background: linear-gradient(90deg, #f7f5ff, #eef6ff);
}
.think-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  color: #8e44ec;
  font-weight: 600;
}
.think-header .chev {
  transition: transform 0.18s ease;
  font-size: 13px;
}
.think-header .chev.open {
  transform: rotate(90deg);
}
.think-header .ico {
  font-size: 14px;
  color: #a855f7;
}
.think-header .title {
  font-size: 12px;
}
.think-header .hint {
  color: #b0a8c4;
  font-weight: 400;
  font-size: 11px;
}
.think-header .live {
  margin-left: auto;
  color: #67c23a;
  font-weight: 400;
  font-size: 11px;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.think-body {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #e0d8f0;
}
.think-md {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.7;
  word-break: break-word;
}
.think-md :deep(p) { margin: 4px 0; }
.think-md :deep(pre) {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 8px;
  overflow-x: auto;
}
.think-md :deep(code) {
  font-family: 'SF Mono', Consolas, Menlo, monospace;
  font-size: 11.5px;
}
.typing {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #a78bfa;
}
.dot-bar {
  display: inline-flex;
  gap: 3px;
}
.dot-bar i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a855f7;
  animation: bounce 1.3s infinite ease-in-out both;
}
.dot-bar i:nth-child(2) { animation-delay: 0.16s; }
.dot-bar i:nth-child(3) { animation-delay: 0.32s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
.cursor {
  display: inline-block;
  color: #a855f7;
  font-weight: 600;
  animation: blink 1s steps(2) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
</style>
