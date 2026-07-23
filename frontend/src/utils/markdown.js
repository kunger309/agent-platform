import { marked } from 'marked'

// marked 配置：GFM 表格/删除线 + 换行即 <br>
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
})

export function escapeHtml(str) {
  if (typeof str !== 'string') return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * 把纯文本/Markdown 渲染为 HTML
 * - 自动把裸图片 URL 转成 markdown 图片
 * - 自动把裸视频 URL 转成带 🎬 前缀的链接
 */
export function renderMarkdown(text) {
  if (typeof text !== 'string') return ''
  let src = text

  // 自动链接裸图片 URL
  src = src.replace(
    /(^|[^(])(https?:\/\/[^\s<>)]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s<>)]*)?)(?=$|[\s)])/gim,
    '$1![]($2)',
  )
  // 自动链接裸视频 URL
  src = src.replace(
    /(^|[^(])(https?:\/\/[^\s<>)]+\.(?:mp4|webm|mov|avi|mkv)(?:\?[^\s<>)]*)?)(?=$|[\s)])/gim,
    '$1[🎬 $2]($2)',
  )

  return marked.parse(src)
}
