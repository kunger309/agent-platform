<template>
  <div class="page">
    <div class="page-head">
      <h2 class="page-title">系统监控</h2>
      <div class="head-right">
        <el-radio-group v-model="hours" size="small" @change="load">
          <el-radio-button :value="1">1 小时</el-radio-button>
          <el-radio-button :value="6">6 小时</el-radio-button>
          <el-radio-button :value="24">24 小时</el-radio-button>
          <el-radio-button :value="72">3 天</el-radio-button>
        </el-radio-group>
        <el-switch
          v-model="autoRefresh"
          size="small"
          active-text="自动刷新"
          style="margin-left: 12px"
        />
        <el-button :icon="Refresh" size="small" style="margin-left: 8px" @click="load">刷新</el-button>
      </div>
    </div>

    <div v-loading="loading">
      <!-- 核心指标卡 -->
      <div class="cards">
        <div class="card">
          <div class="card-label">执行总数</div>
          <div class="card-value">{{ s.execution?.total ?? '-' }}</div>
          <div class="card-sub">
            成功 <b class="ok">{{ s.execution?.success ?? 0 }}</b>
            / 失败 <b class="bad">{{ s.execution?.failed ?? 0 }}</b>
          </div>
        </div>
        <div class="card">
          <div class="card-label">成功率</div>
          <div class="card-value" :class="rateClass">
            {{ s.execution?.successRate != null ? s.execution.successRate + '%' : '-' }}
          </div>
          <div class="card-sub">运行中 {{ s.execution?.running ?? 0 }}</div>
        </div>
        <div class="card">
          <div class="card-label">平均执行耗时</div>
          <div class="card-value">{{ ms(s.execution?.avgDurationMs) }}</div>
          <div class="card-sub">近 {{ hours }} 小时</div>
        </div>
        <div class="card">
          <div class="card-label">工具调用</div>
          <div class="card-value">{{ s.tool?.total ?? '-' }}</div>
          <div class="card-sub">
            失败 <b class="bad">{{ s.tool?.failed ?? 0 }}</b>
            · 均耗时 {{ ms(s.tool?.avgDurationMs) }}
          </div>
        </div>
      </div>

      <el-row :gutter="16" style="margin-top: 16px">
        <el-col :span="16">
          <el-card shadow="never">
            <template #header>
              <span class="card-title">执行趋势（按小时）</span>
            </template>
            <div class="trend">
              <div v-if="!trend.length" class="empty">暂无数据</div>
              <div v-else class="bars">
                <div
                  v-for="b in trend"
                  :key="b.hour"
                  class="bar-col"
                  :title="`${b.hour}\n成功 ${b.success} / 失败 ${b.failed}`"
                >
                  <div class="bar-stack">
                    <div class="bar bar-fail" :style="{ height: h(b.failed) }"></div>
                    <div class="bar bar-ok" :style="{ height: h(b.success) }"></div>
                  </div>
                </div>
              </div>
              <div v-if="trend.length" class="axis">
                <span>{{ trend[0]?.hour }}</span>
                <span>{{ trend[trend.length - 1]?.hour }}</span>
              </div>
              <div class="legend">
                <span><i class="dot ok"></i>成功</span>
                <span><i class="dot bad"></i>失败</span>
              </div>
            </div>
          </el-card>
        </el-col>

        <el-col :span="8">
          <el-card shadow="never">
            <template #header><span class="card-title">平台存量</span></template>
            <div class="kv-list">
              <div class="kv"><span>智能体</span><b>{{ s.entity?.agent ?? '-' }}</b></div>
              <div class="kv"><span>工作流</span><b>{{ s.entity?.workflow ?? '-' }}</b></div>
              <div class="kv"><span>知识库</span><b>{{ s.entity?.knowledgeBase ?? '-' }}</b></div>
              <div class="kv"><span>技能</span><b>{{ s.entity?.skill ?? '-' }}</b></div>
              <div class="kv"><span>启用中 API 密钥</span><b>{{ s.entity?.apiKeyActive ?? '-' }}</b></div>
            </div>
          </el-card>

          <el-card shadow="never" style="margin-top: 16px">
            <template #header><span class="card-title">进程状态</span></template>
            <div class="kv-list">
              <div class="kv"><span>运行时长</span><b>{{ uptime }}</b></div>
              <div class="kv"><span>常驻内存 RSS</span><b>{{ s.process?.rssMb ?? '-' }} MB</b></div>
              <div class="kv"><span>堆内存已用</span><b>{{ s.process?.heapUsedMb ?? '-' }} MB</b></div>
              <div class="kv"><span>Node 版本</span><b>{{ s.process?.nodeVersion ?? '-' }}</b></div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never" style="margin-top: 16px">
        <template #header><span class="card-title">Prometheus 抓取</span></template>
        <div class="scrape">
          <p>
            平台已按 Prometheus 文本格式暴露全量指标（<code>agentx_</code> 前缀），
            在 Prometheus 的 <code>scrape_configs</code> 中加入以下配置即可采集：
          </p>
          <pre class="code-block">scrape_configs:
  - job_name: agent-platform
    metrics_path: /api/metrics
    static_configs:
      - targets: ['{{ hostPort }}']
    # 若设置了 METRICS_TOKEN 环境变量，需额外配置：
    # authorization:
    #   credentials: &lt;METRICS_TOKEN&gt;</pre>
          <p class="tip">
            仓库内附带 Grafana 仪表盘：<code>deploy/grafana/agent-platform-dashboard.json</code>，
            在 Grafana 中「Import → Upload JSON」即可使用。
          </p>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getMonitorSummary } from '@/api';

const s = reactive({});
const loading = ref(false);
const hours = ref(24);
const autoRefresh = ref(false);
let timer = null;

const hostPort = window.location.host;
const trend = computed(() => s.trend || []);

const maxBar = computed(() =>
  Math.max(1, ...trend.value.map((b) => (b.success || 0) + (b.failed || 0))),
);

function h(v) {
  if (!v) return '0px';
  // 最小 2px 保证有数据时肉眼可见
  return `${Math.max(2, Math.round((v / maxBar.value) * 140))}px`;
}

const rateClass = computed(() => {
  const r = s.execution?.successRate;
  if (r == null) return '';
  if (r >= 95) return 'ok';
  if (r >= 80) return 'warn';
  return 'bad';
});

const uptime = computed(() => {
  const sec = s.process?.uptimeSeconds;
  if (sec == null) return '-';
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  return d ? `${d} 天 ${hh} 小时` : hh ? `${hh} 小时 ${mm} 分` : `${mm} 分`;
});

function ms(v) {
  if (v == null) return '-';
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`;
}

async function load() {
  loading.value = true;
  try {
    const data = await getMonitorSummary({ hours: hours.value });
    // 整体替换，避免旧 key 残留
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, data || {});
  } catch (e) {
    ElMessage.warning('监控数据加载失败');
  } finally {
    loading.value = false;
  }
}

watch(autoRefresh, (on) => {
  if (timer) { clearInterval(timer); timer = null; }
  if (on) timer = setInterval(load, 15000);
});

onMounted(load);
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.page-head { display: flex; align-items: center; margin-bottom: 16px; }
.page-title { margin: 0; font-weight: 600; }
.head-right { margin-left: auto; display: flex; align-items: center; }
.card-title { font-weight: 600; font-size: 14px; }

.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.card {
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px; padding: 16px 18px;
}
.card-label { font-size: 13px; color: var(--el-text-color-secondary); }
.card-value { font-size: 28px; font-weight: 600; line-height: 1.4; margin: 4px 0; }
.card-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.ok { color: var(--el-color-success); }
.warn { color: var(--el-color-warning); }
.bad { color: var(--el-color-danger); }

.trend { padding: 4px 0; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 150px; }
.bar-col { flex: 1; display: flex; align-items: flex-end; justify-content: center; height: 100%; }
.bar-stack { width: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.bar { width: 100%; border-radius: 2px 2px 0 0; }
.bar-ok { background: var(--el-color-success); }
.bar-fail { background: var(--el-color-danger); border-radius: 2px 2px 0 0; }
.axis {
  display: flex; justify-content: space-between; margin-top: 8px;
  font-size: 12px; color: var(--el-text-color-secondary);
}
.legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
.dot.ok { background: var(--el-color-success); }
.dot.bad { background: var(--el-color-danger); }
.empty { height: 150px; display: flex; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); }

.kv-list { display: flex; flex-direction: column; gap: 10px; }
.kv { display: flex; justify-content: space-between; font-size: 13px; }
.kv span { color: var(--el-text-color-secondary); }
.kv b { font-weight: 600; }

.scrape p { margin: 0 0 10px; font-size: 13px; color: var(--el-text-color-regular); line-height: 1.7; }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 10px !important; }
.code-block {
  margin: 0; padding: 12px 14px; border-radius: 6px;
  background: var(--el-fill-color-light); color: var(--el-text-color-primary);
  font-size: 12px; line-height: 1.7; overflow-x: auto;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'JetBrains Mono', Consolas, monospace;
}
</style>
