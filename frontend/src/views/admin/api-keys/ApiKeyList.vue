<template>
  <div class="page">
    <div class="page-head">
      <h2 class="page-title">API 密钥</h2>
      <p class="page-desc">
        用于第三方系统直接调用平台的开放接口（<code>/api/v1/**</code>）。密钥独立于登录账号，
        通过 <b>范围（scope）</b> 控制可访问的能力，可随时轮换或吊销。
      </p>
    </div>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索名称"
          clearable
          style="width: 240px"
          :prefix-icon="Search"
        />
        <el-select v-model="statusFilter" style="width: 130px; margin-left: 12px">
          <el-option label="全部状态" value="" />
          <el-option label="启用中" value="active" />
          <el-option label="已吊销" value="revoked" />
          <el-option label="已过期" value="expired" />
        </el-select>
        <el-button style="margin-left: auto" :icon="Refresh" @click="loadList">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">创建密钥</el-button>
      </div>

      <el-table :data="filtered" v-loading="loading" border stripe style="margin-top: 16px">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="密钥" width="200">
          <template #default="{ row }">
            <span class="mono">{{ row.maskedKey }}</span>
          </template>
        </el-table-column>
        <el-table-column label="范围" min-width="240">
          <template #default="{ row }">
            <el-tag
              v-for="s in row.scopes || []"
              :key="s"
              size="small"
              type="info"
              effect="plain"
              class="scope-tag"
            >
              {{ scopeLabel(s) }}
            </el-tag>
            <span v-if="!row.scopes?.length" class="muted">无</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusOf(row).type" size="small">{{ statusOf(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近使用" width="170">
          <template #default="{ row }">
            <span :class="{ muted: !row.lastUsedAt }">{{ fmt(row.lastUsedAt) || '从未使用' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="过期时间" width="170">
          <template #default="{ row }">
            <span :class="{ muted: !row.expiresAt }">{{ fmt(row.expiresAt) || '永不过期' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="warning" link @click="rotate(row)">轮换</el-button>
            <el-button
              v-if="row.status !== 'revoked'"
              type="warning"
              link
              @click="revoke(row)"
            >吊销</el-button>
            <el-button v-else type="success" link @click="enable(row)">恢复</el-button>
            <el-button type="danger" link @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有创建 API 密钥" />
        </template>
      </el-table>
    </el-card>

    <!-- 创建 / 编辑 -->
    <el-dialog v-model="dialog.visible" :title="dialog.id ? '编辑密钥' : '创建密钥'" width="560px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="例如：CRM 系统对接" />
        </el-form-item>
        <el-form-item label="范围">
          <el-checkbox-group v-model="form.scopes">
            <el-checkbox v-for="s in scopes" :key="s.code" :value="s.code" class="scope-check">
              {{ s.label }}
              <span class="mono muted">（{{ s.code }}）</span>
            </el-checkbox>
          </el-checkbox-group>
          <div class="tip">未勾选任何范围的密钥无法调用任何开放接口。</div>
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            placeholder="留空表示永不过期"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            :disabled-date="(d) => d.getTime() < Date.now() - 86400000"
            style="width: 100%"
          />
          <div class="tip">到期后密钥自动失效，不影响已产生的调用记录。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 明文密钥一次性展示 -->
    <el-dialog v-model="plainDialog.visible" title="密钥已生成" width="620px" :close-on-click-modal="false">
      <el-alert
        type="warning"
        :closable="false"
        title="明文密钥只显示这一次"
        description="关闭弹窗后将无法再次查看。请立即复制并妥善保存，如果丢失只能重新轮换。"
        show-icon
      />
      <div class="plain-key">
        <code>{{ plainDialog.key }}</code>
        <el-button type="primary" :icon="CopyDocument" @click="copyKey">复制</el-button>
      </div>
      <div class="usage">
        <div class="usage-title">调用示例</div>
        <pre class="code-block">curl -X POST {{ origin }}/api/v1/agents/&lt;agentId&gt;/chat \
  -H "Authorization: Bearer {{ plainDialog.key }}" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","stream":false}'</pre>
        <div class="tip">也可以用 <code>X-API-Key</code> 请求头替代 <code>Authorization</code>。</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="plainDialog.visible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { Plus, Refresh, Search, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listApiKeys,
  listApiKeyScopes,
  createApiKey,
  updateApiKey,
  rotateApiKey,
  revokeApiKey,
  deleteApiKey,
} from '@/api';

const list = ref([]);
const scopes = ref([]);
const loading = ref(false);
const saving = ref(false);
const keyword = ref('');
const statusFilter = ref('');
const origin = window.location.origin;

const dialog = reactive({ visible: false, id: null });
const form = reactive({ name: '', scopes: [], expiresAt: null });
const plainDialog = reactive({ visible: false, key: '' });

const scopeMap = computed(() => Object.fromEntries(scopes.value.map((s) => [s.code, s.label])));
function scopeLabel(code) { return scopeMap.value[code] || code; }

function statusOf(row) {
  if (row.status === 'revoked') return { label: '已吊销', type: 'danger' };
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return { label: '已过期', type: 'warning' };
  }
  return { label: '启用中', type: 'success' };
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return list.value.filter((r) => {
    if (kw && !String(r.name || '').toLowerCase().includes(kw)) return false;
    if (!statusFilter.value) return true;
    const s = statusOf(r);
    return (
      (statusFilter.value === 'active' && s.label === '启用中')
      || (statusFilter.value === 'revoked' && s.label === '已吊销')
      || (statusFilter.value === 'expired' && s.label === '已过期')
    );
  });
});

function fmt(v) {
  if (!v) return '';
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadList() {
  loading.value = true;
  try {
    const data = await listApiKeys();
    list.value = Array.isArray(data) ? data : data?.items || [];
  } catch (e) {
    ElMessage.warning('密钥列表加载失败');
    list.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadScopes() {
  try {
    const data = await listApiKeyScopes();
    scopes.value = Array.isArray(data) ? data : [];
  } catch { scopes.value = []; }
}

function openCreate() {
  dialog.id = null;
  Object.assign(form, {
    name: '',
    scopes: scopes.value.map((s) => s.code),
    expiresAt: null,
  });
  dialog.visible = true;
}

function openEdit(row) {
  dialog.id = row.id;
  Object.assign(form, {
    name: row.name || '',
    scopes: Array.isArray(row.scopes) ? [...row.scopes] : [],
    expiresAt: row.expiresAt || null,
  });
  dialog.visible = true;
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请填写名称');
  saving.value = true;
  try {
    if (dialog.id) {
      // 更新：expiresAt 传空字符串表示"清除过期时间"（与后端 DTO 约定一致）
      await updateApiKey(dialog.id, {
        name: form.name.trim(),
        scopes: form.scopes,
        expiresAt: form.expiresAt || '',
      });
      ElMessage.success('已保存');
    } else {
      // 创建：不传 expiresAt 表示永不过期（null 会被 IsISO8601 拒绝的风险，统一用 undefined）
      const created = await createApiKey({
        name: form.name.trim(),
        scopes: form.scopes,
        ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
      });
      showPlain(created);
    }
    dialog.visible = false;
    loadList();
  } catch (e) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function showPlain(data) {
  const key = data?.plainKey || data?.key;
  if (!key) return ElMessage.success('已创建');
  plainDialog.key = key;
  plainDialog.visible = true;
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(plainDialog.key);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.warning('复制失败，请手动选中复制');
  }
}

async function rotate(row) {
  await ElMessageBox.confirm(
    `轮换后「${row.name}」的旧密钥会立即失效，所有使用旧密钥的调用方都需要更新。确认继续？`,
    '轮换密钥',
    { type: 'warning' },
  );
  const data = await rotateApiKey(row.id);
  showPlain(data);
  loadList();
}

async function revoke(row) {
  await ElMessageBox.confirm(
    `吊销后「${row.name}」将立即失效且不可恢复（可重新轮换生成新密钥）。确认继续？`,
    '吊销密钥',
    { type: 'warning' },
  );
  await revokeApiKey(row.id);
  ElMessage.success('已吊销');
  loadList();
}

async function enable(row) {
  await updateApiKey(row.id, { status: 'active' });
  ElMessage.success('已恢复启用');
  loadList();
}

async function del(row) {
  await ElMessageBox.confirm(`确认删除密钥「${row.name}」？调用记录不会被删除。`, '提示', { type: 'warning' });
  await deleteApiKey(row.id);
  ElMessage.success('已删除');
  loadList();
}

onMounted(() => { loadScopes().then(loadList); });
</script>

<style scoped>
.page-head { margin-bottom: 16px; }
.page-title { margin: 0 0 6px; font-weight: 600; }
.page-desc { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.toolbar { display: flex; align-items: center; gap: 8px; }
.mono {
  font-family: 'Microsoft YaHei', 'PingFang SC', 'JetBrains Mono', Consolas, monospace;
  letter-spacing: 0.3px;
}
.muted { color: var(--el-text-color-placeholder); }
.scope-tag { margin: 2px 4px 2px 0; }
.scope-check { display: block; margin-right: 0; line-height: 28px; }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; }
.plain-key {
  display: flex; align-items: center; gap: 12px;
  margin: 16px 0; padding: 12px 14px;
  background: var(--el-fill-color-light); border-radius: 6px;
}
.plain-key code {
  flex: 1; word-break: break-all; font-size: 13px;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'JetBrains Mono', Consolas, monospace;
}
.usage-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.code-block {
  margin: 0; padding: 12px 14px; border-radius: 6px;
  background: var(--el-fill-color-light); color: var(--el-text-color-primary);
  font-size: 12px; line-height: 1.7; overflow-x: auto;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'JetBrains Mono', Consolas, monospace;
}
</style>
