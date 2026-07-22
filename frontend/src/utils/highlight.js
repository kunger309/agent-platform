import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

export function highlightCode(code, language) {
    return hljs.highlight(code, { language }).value;
}

export function initHighlighting() {
    hljs.initHighlightingOnLoad();
}