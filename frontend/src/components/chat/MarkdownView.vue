<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.min.css'
import { renderMarkdown } from '@/utils/markdown.js'

const props = defineProps({
  content: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
})

const rootRef = ref(null)

function addCodeHeaders(el) {
  if (!el) return
  el.querySelectorAll('pre code').forEach((codeEl) => {
    const pre = codeEl.parentElement
    if (pre.querySelector('.code-header')) return
    const lang = (codeEl.className.match(/language-(\w+)/) || [])[1] || ''
    const header = document.createElement('div')
    header.className = 'code-header'
    header.innerHTML = `
      <span class="lang">${lang || 'code'}</span>
      <button type="button">复制</button>
    `
    const btn = header.querySelector('button')
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        btn.textContent = '✓ 已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      })
    })
    pre.insertBefore(header, codeEl)
    pre.classList.add('hljs-pre')
  })
}

function highlightCode(el) {
  if (!el) return
  el.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
    hljs.highlightElement(block)
  })
}

function addImageLightbox(el) {
  if (!el) return
  el.querySelectorAll('img').forEach((img) => {
    if (img.dataset.lightbox) return
    img.dataset.lightbox = '1'
    img.addEventListener('click', () => {
      const overlay = document.createElement('div')
      overlay.className = 'img-lightbox'
      overlay.innerHTML = `<img src="${img.src}" alt="">`
      overlay.addEventListener('click', () => overlay.remove())
      document.body.appendChild(overlay)
    })
  })
}

// 流式期间只做轻量后处理（图片灯箱），跳过耗时的 hljs 高亮，
// 避免每个打字机 tick 都重新高亮整段内容导致卡顿。
function lightPost() {
  if (!rootRef.value) return
  addImageLightbox(rootRef.value)
}
// 定稿时（流式结束）再做完整高亮 + 代码头 + 灯箱
function fullPost() {
  if (!rootRef.value) return
  highlightCode(rootRef.value)
  addCodeHeaders(rootRef.value)
  addImageLightbox(rootRef.value)
}

const html = ref(renderMarkdown(props.content))
watch(
  () => props.content,
  (v) => {
    html.value = renderMarkdown(v)
    nextTick(() => (props.streaming ? lightPost() : fullPost()))
  },
  { immediate: true },
)
// 流式结束（streaming 由 true 变 false）时对最终内容做完整高亮
watch(
  () => props.streaming,
  (s) => { if (!s) nextTick(fullPost) },
)
onMounted(() => nextTick(() => (props.streaming ? lightPost() : fullPost())))
</script>

<template>
  <div
    ref="rootRef"
    class="md-view"
    :class="{ streaming: props.streaming }"
    v-html="html"
  ></div>
</template>

<style scoped>
.md-view {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-regular);
  word-break: break-word;
}
.md-view :deep(p) { margin: 6px 0; }
.md-view :deep(h1),
.md-view :deep(h2),
.md-view :deep(h3),
.md-view :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}
.md-view :deep(h1) { font-size: 19px; }
.md-view :deep(h2) { font-size: 17px; }
.md-view :deep(h3) { font-size: 15px; }
.md-view :deep(ul),
.md-view :deep(ol) { padding-left: 22px; margin: 6px 0; }
.md-view :deep(li) { margin: 3px 0; }
.md-view :deep(a) { color: var(--brand-primary); text-decoration: none; }
.md-view :deep(a:hover) { text-decoration: underline; }
.md-view :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--border-base);
  background: var(--el-fill-color-light);
  color: var(--text-secondary);
}
.md-view :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
  width: 100%;
}
.md-view :deep(th),
.md-view :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 6px 10px;
  text-align: left;
}
.md-view :deep(th) { background: var(--el-fill-color-light); font-weight: 600; color: var(--text-primary); }
.md-view :deep(hr) { border: none; border-top: 1px solid var(--border-base); margin: 12px 0; }
.md-view :deep(img) {
  max-width: 100%;
  border-radius: 6px;
  cursor: zoom-in;
  margin: 4px 0;
}
.md-view :deep(code) {
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12.5px;
  background: var(--el-fill-color-light);
  padding: 1px 5px;
  border-radius: 4px;
  color: #d63384;
}
.md-view :deep(pre) {
  position: relative;
  margin: 8px 0;
  border-radius: 8px;
  background: #0d1117;
  overflow: hidden;
}
.md-view :deep(pre code) {
  display: block;
  padding: 12px 14px;
  background: transparent;
  color: #e6edf3;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
}
.md-view :deep(pre.hljs-pre) {
  padding-top: 0;
}
.md-view :deep(.code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  font-size: 11px;
  color: #8b949e;
}
.md-view :deep(.code-header .lang) {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.md-view :deep(.code-header button) {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 11px;
}
.md-view :deep(.code-header button:hover) { background: #30363d; }
.md-view.streaming :deep(p:last-child)::after {
  content: '▍';
  color: var(--brand-primary);
  font-weight: 600;
  animation: blink 1s steps(2) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
</style>

<style>
/* 全局（灯箱不 scoped） */
.img-lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: zoom-out;
}
.img-lightbox img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
</style>
