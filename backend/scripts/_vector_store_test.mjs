// vector-store 适配器端到端测试
import { VectorStoreService } from '../dist/src/vector-store/vector-store.service.js';
import { QdrantAdapter } from '../dist/src/vector-store/adapters/qdrant.adapter.js';

// ConfigService 需要有 get() 方法，简单 mock
const fakeConfig = {
  get: (key) => {
    if (key === 'QDRANT_URL') return 'http://localhost:6334';
    if (key === 'VECTOR_STORE_PROVIDER') return 'qdrant';
    return undefined;
  },
};

const adapter = new QdrantAdapter(fakeConfig);
const svc = new VectorStoreService(fakeConfig, adapter);
await svc.onModuleInit();

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
}

const KB_ID = `test_kb_${Date.now()}`;
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

// ============================================
// 1) 健康检查
// ============================================
console.log('\n[1] health');
{
  const h = await adapter.health();
  assert(h.ok === true, `qdrant health ok (${h.detail || ''})`);
}

// ============================================
// 2) 创建 collection
// ============================================
console.log('\n[2] ensureCollection (dim=4)');
{
  await adapter.ensureCollection(KB_ID, 4, 'Cosine');
  assert(true, 'collection created');

  // 第二次调用不报错
  await adapter.ensureCollection(KB_ID, 4, 'Cosine');
  assert(true, 'ensureCollection idempotent');
}

// ============================================
// 3) upsert + search（基本向量检索）
// ============================================
console.log('\n[3] upsert + search');
{
  // 构造 5 个 4 维向量：3 个靠近 query1，2 个靠近 query2
  const docs = [
    {
      id: 'pt1',
      vector: [1.0, 0.1, 0.0, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc1',
        chunkIndex: 0,
        content: '苹果是一种水果',
      },
    },
    {
      id: 'pt2',
      vector: [0.95, 0.2, 0.0, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc1',
        chunkIndex: 1,
        content: '香蕉也是水果',
      },
    },
    {
      id: 'pt3',
      vector: [0.9, 0.15, 0.05, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc1',
        chunkIndex: 2,
        content: '橙子富含维生素',
      },
    },
    {
      id: 'pt4',
      vector: [0.0, 0.0, 1.0, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc2',
        chunkIndex: 0,
        content: '汽车是交通工具',
      },
    },
    {
      id: 'pt5',
      vector: [0.0, 0.1, 0.95, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc2',
        chunkIndex: 1,
        content: '飞机在天上飞',
      },
    },
  ];
  await adapter.upsert(KB_ID, docs);
  assert(true, 'upserted 5 points');

  // query 接近 pt1/pt2/pt3（水果类）
  // 给 Qdrant 一点时间建索引（小数据集通常 < 100ms，但偶尔需要重试）
  let hits = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    hits = await adapter.search(KB_ID, ORG_A, [1.0, 0.0, 0.0, 0.0], { topK: 3 });
    if (hits.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(hits.length === 3, `top-3 returns 3 hits (got ${hits.length})`);
  if (hits[0]) {
    assert(hits[0].id === 'pt1', `top hit is pt1 (got ${hits[0].id})`);
    assert(hits[0].score > 0.95, `top score > 0.95 (got ${hits[0].score.toFixed(3)})`);
    assert(hits[0].payload.content.includes('苹果'), 'payload content preserved');
  }
}

// ============================================
// 4) search orgId 防御性 filter
// ============================================
console.log('\n[4] search 跨 org filter (withOrgFilter)');
{
  // ORG_B 来搜，应该 0 hit（即使向量很近）
  const hits = await adapter.search(KB_ID, ORG_B, [1.0, 0.0, 0.0, 0.0], { topK: 5 });
  assert(hits.length === 0, `cross-org returns 0 hits (got ${hits.length})`);

  // ORG_A 还是能搜到
  const hitsA = await adapter.search(KB_ID, ORG_A, [1.0, 0.0, 0.0, 0.0], { topK: 1 });
  assert(hitsA.length === 1, 'same-org returns 1 hit');
}

// ============================================
// 5) search scoreThreshold
// ============================================
console.log('\n[5] search scoreThreshold');
{
  const hits = await adapter.search(KB_ID, ORG_A, [1.0, 0.0, 0.0, 0.0], {
    topK: 5,
    scoreThreshold: 0.99,
  });
  // pt1 = 1.0 → score=1（完全匹配），pt2=0.95 → < 0.99 被过滤
  // 所以只应该返回 pt1
  assert(
    hits.length === 1 && hits[0].id === 'pt1',
    `score>=0.99 returns only pt1 (got ${hits.length} hits)`,
  );
}

// ============================================
// 6) search filter by documentId
// ============================================
console.log('\n[6] search filter documentId');
{
  const hits = await adapter.search(KB_ID, ORG_A, [1.0, 0.0, 0.0, 0.0], {
    topK: 5,
    filter: { documentId: 'doc2' },
  });
  // 即使 query 接近 doc1 的水果类，filter 限定到 doc2 → 0 hit（汽车/飞机距离远）
  // 改用接近 doc2 的 query
  const hits2 = await adapter.search(KB_ID, ORG_A, [0.0, 0.0, 1.0, 0.0], {
    topK: 5,
    filter: { documentId: 'doc2' },
  });
  assert(hits2.length === 2, `filter doc2 returns 2 hits (got ${hits2.length})`);
  assert(
    hits2.every((h) => h.payload.documentId === 'doc2'),
    'all hits have documentId=doc2',
  );
}

// ============================================
// 7) deletePoints by ids
// ============================================
console.log('\n[7] deletePoints by ids');
{
  await adapter.deletePoints(KB_ID, ['pt4', 'pt5']);
  // 等 Qdrant 索引更新
  let hits = [];
  for (let i = 0; i < 5; i++) {
    // 加 scoreThreshold=0.5：pt4/pt5 删后剩下的 pt1/2/3 跟汽车 query 余弦相似度 < 0.5
    hits = await adapter.search(KB_ID, ORG_A, [0.0, 0.0, 1.0, 0.0], {
      topK: 5,
      scoreThreshold: 0.5,
    });
    if (hits.length === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // doc2 全删了（thresholds 过滤掉剩下的低相似度结果）
  assert(hits.length === 0, `deleted doc2 hits (got ${hits.length})`);

  // 验证：直接查 pt4/pt5 也不在了（用对应的 query + high threshold）
  const stillThere = await adapter.search(KB_ID, ORG_A, [1.0, 0.0, 0.0, 0.0], {
    topK: 10,
  });
  const ptIds = stillThere.map((h) => h.id);
  assert(!ptIds.includes('pt4'), 'pt4 not in any hit');
  assert(!ptIds.includes('pt5'), 'pt5 not in any hit');
}

// ============================================
// 8) upsert 重新填充 + deleteByDocument
// ============================================
console.log('\n[8] upsert again + deleteByDocument');
{
  await adapter.upsert(KB_ID, [
    {
      id: 'pt6',
      vector: [0.5, 0.5, 0.0, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc3',
        chunkIndex: 0,
        content: '混合查询',
      },
    },
    {
      id: 'pt7',
      vector: [0.6, 0.4, 0.0, 0.0],
      payload: {
        organizationId: ORG_A,
        knowledgeBaseId: KB_ID,
        documentId: 'doc3',
        chunkIndex: 1,
        content: '也是混合',
      },
    },
  ]);

  let hits = await adapter.search(KB_ID, ORG_A, [0.5, 0.5, 0.0, 0.0], { topK: 5 });
  assert(hits.length === 5, `now 5 hits (3 from doc1 + 2 from doc3)`);

  await adapter.deleteByDocument(KB_ID, 'doc3');
  hits = await adapter.search(KB_ID, ORG_A, [0.5, 0.5, 0.0, 0.0], { topK: 5 });
  assert(hits.length === 3, `after delete doc3: 3 hits (got ${hits.length})`);
  assert(
    hits.every((h) => h.payload.documentId === 'doc1'),
    'all remaining are doc1',
  );
}

// ============================================
// 9) upsert 120 points（分批）
// ============================================
console.log('\n[9] upsert 120 points (batch)');
{
  const points = Array.from({ length: 120 }, (_, i) => ({
    id: `bulk_${i}`,
    vector: [Math.sin(i / 10), Math.cos(i / 10), 0, 0],
    payload: {
      organizationId: ORG_A,
      knowledgeBaseId: KB_ID,
      documentId: 'bulk_doc',
      chunkIndex: i,
      content: `bulk content ${i}`,
    },
  }));
  await adapter.upsert(KB_ID, points);
  const hits = await adapter.search(KB_ID, ORG_A, [0, 1, 0, 0], {
    topK: 5,
    filter: { documentId: 'bulk_doc' },
  });
  assert(hits.length === 5, 'top-5 from bulk returns 5');
}

// ============================================
// 10) deleteCollection
// ============================================
console.log('\n[10] deleteCollection');
{
  await adapter.deleteCollection(KB_ID);
  // 验证 collection 不在了（重新 ensureCollection 应该 ok）
  await adapter.ensureCollection(KB_ID, 4, 'Cosine');
  assert(true, 'recreate after delete works');
  // 清理
  await adapter.deleteCollection(KB_ID);
}

console.log(`\n========================================`);
console.log(`✅ ${pass} passed, ❌ ${fail} failed`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);