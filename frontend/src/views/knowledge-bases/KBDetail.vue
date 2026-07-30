<template>
  <div class="kb-detail page-container" v-loading="loadingKB">
    <!-- 头部 -->
    <div class="page-header">
      <div class="title-row">
        <el-button :icon="ArrowLeft" circle plain @click="goBack" />
        <div>
          <h2>{{ kb.name }}</h2>
          <div class="muted sub">{{ kb.description || '暂无描述' }}</div>
        </div>
      </div>
      <div class="meta">
        <el-tag size="small" type="warning">{{ kb.embeddingModel }}</el-tag>
        <el-tag size="small" effect="plain">TopK {{ (kb.retrievalConfig && kb.retrievalConfig.topK) || 5 }}</el-tag>
        <el-tag size="small" :type="kb.status === 'active' ? 'success' : 'info'">
          {{ kb.status === 'active' ? '启用' : '归档' }}
        </el-tag>
      </div>
    </div>

    <el-row :gutter="16">
      <!-- 左：文档管理 -->
      <el-col :span="14">
        <el-card shadow="never" class="block">
          <template #header>
            <div class="card-head">
              <span>文档（{{ docs.length }}）</span>
              <el-upload
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleFileChange"
                accept=".txt,.md,.pdf,.docx,.csv,.html"
                :disabled="uploading"
              >
                <el-button type="primary" :icon="Upload" :loading="uploading">上传文档</el-button>
              </el-upload>
            </div>
          </template>

          <el-table :data="docs" v-loading="loadingDocs" stripe size="small">
            <el-table-column label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.name }}</template>
            </el-table-column>
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <span class="muted">{{ extOf(row.name) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="90">
              <template #default="{ row }">{{ fmtSize(row.size) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tooltip v-if="row.parseStatus === 'failed'" :content="row.errorMessage" placement="top">
                  <el-tag type="danger" size="small">失败</el-tag>
                </el-tooltip>
                <el-tag v-else :type="statusType(row.parseStatus)" size="small">
                  {{ statusLabel(row.parseStatus) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="切片" width="70" align="center">
              <template #default="{ row }">{{ row.chunkCount || 0 }}</template>
            </el-table-column>
            <el-table-column label="操作" width="240" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  :disabled="!row.chunkCount"
                  @click="openChunks(row)"
                  >查看切片</el-button
                >
                <el-button
                  v-if="row.parseStatus === 'failed'"
                  size="small"
                  @click="retryIt(row)"
                  >重试</el-button
                >
                <el-button
                  size="small"
                  :icon="Download"
                  :loading="downloadingId === row.id"
                  @click="downloadIt(row)"
                  >下载</el-button
                >
                <el-button size="small" type="danger" @click="removeIt(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!loadingDocs && docs.length === 0" description="还没有文档，点击右上角上传" />
        </el-card>
      </el-col>

      <!-- 右：检索测试 -->
      <el-col :span="10">
        <el-card shadow="never" class="block">
          <template #header><span>检索测试</span></template>
          <el-input
            v-model="query"
            type="textarea"
            :rows="2"
            placeholder="输入要检索的问题，如：预算审批需要谁签字？"
          />
          <div class="retrieve-opts">
            <el-input-number v-model="topK" :min="1" :max="20" size="small" />
            <span class="muted">TopK</span>
            <el-button
              type="primary"
              :icon="Search"
              :loading="retrieving"
              @click="doRetrieve"
              style="margin-left: auto"
              >检索</el-button
            >
          </div>

          <div v-if="retrieveResult" class="retrieve-result">
            <div class="result-meta muted">
              命中 {{ retrieveResult.total }} 条（query: {{ retrieveResult.query }}）
            </div>
            <el-empty v-if="retrieveResult.total === 0" description="无命中结果" :image-size="60" />
            <div
              v-for="(r, i) in retrieveResult.results"
              :key="r.id"
              class="result-item"
            >
              <div class="result-bar">
                <span class="rank">#{{ i + 1 }}</span>
                <el-tag
                  v-for="s in r.sources"
                  :key="s"
                  size="small"
                  :type="s === 'vector' ? 'primary' : 'success'"
                  effect="plain"
                  >{{ s === 'vector' ? '向量' : 'BM25' }}</el-tag
                >
                <span class="muted score">RRF={{ r.score?.toFixed(4) }}</span>
                <span v-if="r.vectorScore != null" class="muted score">vec={{ r.vectorScore.toFixed(4) }}</span>
                <span v-if="r.bm25Score != null" class="muted score">bm25={{ r.bm25Score.toFixed(4) }}</span>
                <span class="muted src">来自：{{ docName(r.documentId) }}</span>
              </div>
              <pre class="content">{{ r.content }}</pre>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 切片详情抽屉 -->
    <el-drawer
      v-model="chunksDrawer.visible"
      :title="`切片详情 - ${chunksDrawer.docName || ''}`"
      direction="rtl"
      size="55%"
      destroy-on-close
    >
      <div v-loading="chunksDrawer.loading" class="chunks-wrap">
        <div class="chunks-meta muted">
          共 {{ chunksDrawer.list.length }} 个切片
          <span v-if="chunksDrawer.docName">（源文档：{{ chunksDrawer.docName }}）</span>
        </div>
        <el-empty
          v-if="!chunksDrawer.loading && chunksDrawer.list.length === 0"
          description="暂无切片"
          :image-size="60"
        />
        <div
          v-for="c in chunksDrawer.list"
          :key="c.id"
          class="chunk-card"
        >
          <div class="chunk-bar">
            <el-tag size="small" type="info" effect="plain">#{{ c.chunkIndex }}</el-tag>
            <el-tag v-if="c.pageNumber" size="small" effect="plain">页 {{ c.pageNumber }}</el-tag>
            <span class="muted tokens">{{ c.tokenCount || 0 }} tokens</span>
          </div>
          <pre class="chunk-content">{{ c.content }}</pre>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Upload, Search, Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getToken } from '@/api/client';
import {
  getKnowledgeBase,
  listDocuments,
  uploadDocument,
  retryDocument,
  removeDocument,
  retrieve,
  listChunks,
} from '@/api/knowledge-bases';

const route = useRoute();
const router = useRouter();
const kbId = route.params.id;

const kb = reactive({ name: '', description: '', embeddingModel: '', status: 'active', retrievalConfig: null });
const docs = ref([]);
const loadingKB = ref(false);
const loadingDocs = ref(false);
const uploading = ref(false);
const retrieving = ref(false);
const retrieveResult = ref(null);
// 下载中的文档 id（用于按钮 loading 态，避免重复点击）
const downloadingId = ref(null);

const query = ref('');
const topK = ref(5);

const chunksDrawer = reactive({ visible: false, loading: false, docId: null, docName: '', list: [] });

let pollTimer = null;

// ============ 加载 ============
async function loadKB() {
  loadingKB.value = true;
  try {
    const data = await getKnowledgeBase(kbId);
    Object.assign(kb, data);
  } finally {
    loadingKB.value = false;
  }
}

async function loadDocs() {
  loadingDocs.value = true;
  try {
    docs.value = await listDocuments(kbId);
    // 若有进行中的文档，开轮询
    maybeStartPolling();
  } finally {
    loadingDocs.value = false;
  }
}

// ============ 上传 ============
async function handleFileChange(file) {
  if (!file || !file.raw) return;
  const raw = file.raw;
  uploading.value = true;
  try {
    await uploadDocument(kbId, raw);
    ElMessage.success(`已上传 ${raw.name}，开始解析`);
    await loadDocs();
  } catch {
    /* 错误已由拦截器提示 */
  } finally {
    uploading.value = false;
  }
}

// ============ 轮询解析状态 ============
function maybeStartPolling() {
  const pending = docs.value.some(
    (d) => d.parseStatus === 'pending' || d.parseStatus === 'processing',
  );
  if (pending && !pollTimer) {
    pollTimer = setInterval(async () => {
      const still = docs.value.some(
        (d) => d.parseStatus === 'pending' || d.parseStatus === 'processing',
      );
      if (!still) {
        stopPolling();
        await loadDocs();
        return;
      }
      docs.value = await listDocuments(kbId);
    }, 2000);
  }
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ============ 文档操作 ============
async function retryIt(row) {
  await retryDocument(kbId, row.id);
  ElMessage.success('已重新触发解析');
  await loadDocs();
}
async function removeIt(row) {
  await removeDocument(kbId, row.id);
  ElMessage.success('已删除');
  await loadDocs();
}

/**
 * 下载原文件：用 fetch + Authorization 头拿 blob，再用 <a download> 触发下载。
 *
 * 不能直接 <a href="/api/.../download"> 因为 axios 的拦截器注入 token；
 * 而 <a> 不会带 Authorization。fetch + blob + objectURL 是最通用的方案。
 *
 * 服务端用 res.download() 自动设置 Content-Disposition（含 RFC 5987 中文编码），
 * 因此后端响应头里带的 filename 才是"权威"，下面回退到 row.originalName 只是为了
 * 服务端头缺失时的兜底。
 */
async function downloadIt(row) {
  if (downloadingId.value) return;
  downloadingId.value = row.id;
  try {
    const token = getToken();
    const r = await fetch(`/api/knowledge-bases/${kbId}/documents/${row.id}/download`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      // 服务端在 4xx/5xx 时返回 { success:false, message }，尽量把 message 提取出来
      let msg = `下载失败（${r.status}）`;
      try {
        const j = await r.json();
        if (j?.message) msg = j.message;
      } catch (_) {}
      ElMessage.error(msg);
      return;
    }
    // 解析服务端给出的文件名（处理 RFC 5987）
    const dispo = r.headers.get('Content-Disposition') || '';
    const fileName = parseContentDispositionFileName(dispo) || row.originalName || row.name;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 延迟释放 URL，确保浏览器完成下载后再 revoke
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    ElMessage.error('下载失败：' + (e?.message || e));
  } finally {
    downloadingId.value = null;
  }
}

/**
 * 从 Content-Disposition 头解析 filename，优先 RFC 5987 的 filename*=UTF-8''xxx。
 * 失败回退到普通 filename="..."。
 */
function parseContentDispositionFileName(header) {
  if (!header) return null;
  // filename*=UTF-8''<percent-encoded>  形式
  const m5987 = header.match(/filename\*\s*=\s*([^']+)''([^;]+)/i);
  if (m5987) {
    try {
      return decodeURIComponent(m5987[2]);
    } catch (_) {}
  }
  // 普通 filename="..."
  const m = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return m ? m[1] : null;
}

// ============ 切片详情抽屉 ============
async function openChunks(row) {
  chunksDrawer.docId = row.id;
  chunksDrawer.docName = row.name;
  chunksDrawer.list = [];
  chunksDrawer.visible = true;
  chunksDrawer.loading = true;
  try {
    chunksDrawer.list = await listChunks(kbId, row.id);
  } finally {
    chunksDrawer.loading = false;
  }
}

// ============ 检索 ============
async function doRetrieve() {
  if (!query.value.trim()) {
    ElMessage.warning('请输入检索内容');
    return;
  }
  retrieving.value = true;
  retrieveResult.value = null;
  try {
    retrieveResult.value = await retrieve(kbId, query.value.trim(), { topK: topK.value });
  } finally {
    retrieving.value = false;
  }
}

// ============ 工具 ============
function extOf(name = '') {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : '—';
}
function fmtSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function statusType(s) {
  return { pending: 'info', processing: 'warning', completed: 'success', failed: 'danger' }[s] || 'info';
}
function statusLabel(s) {
  return { pending: '排队中', processing: '处理中', completed: '已完成', failed: '失败' }[s] || s;
}
const docNameMap = computed(() => {
  const m = {};
  docs.value.forEach((d) => (m[d.id] = d.name));
  return m;
});
function docName(docId) {
  return docNameMap.value[docId] || docId || '未知';
}

function goBack() {
  router.push('/knowledge-bases');
}

onMounted(() => {
  loadKB();
  loadDocs();
});
onBeforeUnmount(stopPolling);
</script>

<style scoped>
.kb-detail { padding: 0; }
.page-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 16px; gap: 16px; flex-wrap: wrap;
}
.title-row { display: flex; align-items: center; gap: 12px; }
.title-row h2 { margin: 0; }
.sub { font-size: 13px; margin-top: 4px; }
.meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.muted { color: #909399; font-size: 12px; }
.block { margin-bottom: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.retrieve-opts { display: flex; align-items: center; gap: 8px; margin: 12px 0; }
.retrieve-result { margin-top: 8px; }
.result-meta { margin-bottom: 8px; }
.result-item {
  border: 1px solid #ebeef5; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;
  background: #fafafa;
}
.result-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.rank { font-weight: 600; color: #409eff; }
.score { margin-left: 4px; }
.src { margin-left: auto; }
.content {
  margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 13px;
  line-height: 1.6; max-height: 160px; overflow: auto; font-family: inherit;
}
.chunks-wrap { padding: 0 4px; }
.chunks-meta { margin-bottom: 12px; }
.chunk-card {
  border: 1px solid #ebeef5; border-radius: 6px; padding: 8px 10px;
  margin-bottom: 10px; background: #fafbfc;
}
.chunk-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.chunk-bar .tokens { margin-left: auto; }
.chunk-content {
  margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 13px;
  line-height: 1.7; font-family: inherit; max-height: 280px; overflow: auto;
}
</style>
