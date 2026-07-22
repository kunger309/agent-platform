<template>
  <div class="markdown-renderer">
    <div v-html="renderedContent"></div>
  </div>
</template>

<script >
import { defineComponent, ref, watch } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

export default defineComponent({
  name: 'MarkdownRenderer',
  props: {
    content: {
      type: String,
      required: true
    }
  },
  setup(props) {
    const renderedContent = ref('');

    const renderMarkdown = (markdown) => {
      const html = marked(markdown);
      return html.replace(/<pre><code class="(.+?)">/g, (match, lang) => {
        return `<pre><code class="${lang}">${hljs.highlight(lang, match).value}</code>`;
      });
    };

    watch(() => props.content, (newContent) => {
      renderedContent.value = renderMarkdown(newContent);
    }, { immediate: true });

    return {
      renderedContent
    };
  }
});
</script>

<style scoped>
.markdown-renderer {
  padding: 1em;
  background-color: #f9f9f9;
  border-radius: 5px;
  overflow: auto;
}
</style>