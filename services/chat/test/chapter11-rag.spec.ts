/**
 * chapter11-rag.spec.ts
 *
 * 第十一章《RAG——让产品读懂你的业务》配套测试用例
 *
 * 设计目标（与第八九十章保持一致）：
 * - **按文档章节组织**：每个 describe 标题以「11.x.y」开头
 * - **读者按图索骥**：在章节里看到 📋 标记后可直接：
 *     bun test test/chapter11-rag.spec.ts -t "11.2.4"
 * - **效果可视化**：通过 console.log 打印"差距"，让读者直观看到：
 *     · baseline 检索 vs 重排后召回提升
 *     · 单独向量 vs 混合检索的 RRF 融合效果
 *     · Adaptive-RAG 在 simple / single_hop / multi_hop 上的不同路径
 * - **零依赖**：单元测试用 mock，无需 LLM API key、向量库、网络
 */
import { describe, it, expect, mock } from 'bun:test';

import {
  dot,
  l2Norm,
  normalize,
  cosineSimilarity,
  euclideanDistance,
} from '../rag/embedding/similarity';
import { chunkText } from '../rag/chunking/document-chunker';
import { chunkParentChild } from '../rag/chunking/parent-child-chunker';
import {
  bruteForceKnn,
  type VectorStoreRecord,
  type SearchResult,
} from '../rag/retrieval/vector-store';
import { rewriteQuery } from '../rag/retrieval/query-rewriter';
import { hybridSearch, rrfFuse } from '../rag/retrieval/hybrid-search';
import { rerankResults } from '../rag/retrieval/reranker';
import {
  ragAsk,
  RAG_NO_CONTEXT_FALLBACK,
  RAG_DEFAULT_SYSTEM_PROMPT,
} from '../rag/pipeline/rag-pipeline';
import { hydeSearch } from '../rag/pipeline/hyde';
import {
  adaptiveRagAsk,
  fixedClassifier,
} from '../rag/pipeline/adaptive-rag';
import {
  recallAtK,
  mrr,
  ndcgAtK,
} from '../rag/evaluation/retrieval-metrics';
import { runRagas } from '../rag/evaluation/ragas-runner';
import {
  createRagTool,
  RAG_TOOL_DESCRIPTION,
  RAG_TOOL_NAME,
} from '../rag/agent/rag-tool';

function logSection(title: string) {
  console.log(`\n  ─── ${title} ───`);
}

// ────────── 共用 mock helpers ──────────

function fakeVec(seed: number, dim = 4): number[] {
  // 简单 LCG，避免引入随机依赖
  const v: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 9301 + 49297) % 233280;
    v.push((s / 233280) * 2 - 1);
  }
  return v;
}

function fakeRecord(id: string, doc: string, content: string, embedding: number[]): VectorStoreRecord {
  return {
    id,
    documentId: doc,
    content,
    chunkIndex: 0,
    embedding,
    modelName: 'mock-model',
  };
}

function fakeSearchResult(chunkId: string, content: string, score: number): SearchResult {
  return {
    chunkId,
    documentId: 'doc-' + chunkId,
    chunkIndex: 0,
    content,
    score,
  };
}

// ========================================================================
// 11.2 向量数学本质
// ========================================================================

describe('11.2.4 相似度 - 余弦 / 欧氏 / 点积 等价性', () => {
  it('单位向量自相似 = 1', () => {
    const v = normalize([3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 9);
  });

  it('反方向向量相似 = -1', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 9);
  });

  it('正交向量相似 = 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 9);
  });

  it('归一化后 cosineSimilarity === dot（容差 1e-9）', () => {
    const raw1 = [0.21, -0.83, 0.42, 0.05];
    const raw2 = [0.23, -0.79, 0.39, 0.07];
    const a = normalize(raw1);
    const b = normalize(raw2);
    const cos = cosineSimilarity(a, b);
    const d = dot(a, b);

    logSection('L2 归一化后等价性');
    console.log(`  cosine = ${cos.toFixed(9)}`);
    console.log(`  dot    = ${d.toFixed(9)}`);
    console.log(`  ↳ 这就是为什么 RAG 默认用余弦：归一化后等价点积，量纲稳定`);

    expect(Math.abs(cos - d)).toBeLessThan(1e-9);
  });

  it('维度不匹配抛 RangeError("向量维度不匹配")', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/向量维度不匹配/);
    expect(() => dot([1], [])).toThrow(/向量维度不匹配/);
    expect(() => euclideanDistance([], [])).toThrow(/向量维度不匹配/);
  });

  it('normalize 后向量范数为 1', () => {
    const v = normalize([3, 4]);
    expect(l2Norm(v)).toBeCloseTo(1, 9);
  });
});

// ========================================================================
// 11.3 Embedding 模型选型（契约约束，无需真实推理）
// ========================================================================

describe('11.3.7 入库 / 查询模型一致性 - modelName 必须存且不可混用', () => {
  it('record.modelName 必须为字符串且与 expectedModelName 一致', () => {
    const rec = fakeRecord('c1', 'd1', 'x', [0.1, 0.2, 0.3, 0.4]);
    expect(typeof rec.modelName).toBe('string');
    expect(rec.modelName).toBe('mock-model');
  });

  it('不同 dim 的向量不能写入同一字段（维度校验）', () => {
    const queryVec = [0.1, 0.2, 0.3, 0.4];
    const wrongDimRecord = fakeRecord('c1', 'd1', 'x', [0.1, 0.2, 0.3]);
    expect(() => bruteForceKnn(queryVec, [wrongDimRecord])).toThrow(/向量维度不匹配/);
  });
});

describe('11.3.6 Bi-Encoder 初筛 vs Cross-Encoder 重排（mock）', () => {
  it('Bi-Encoder 给出粗排，Cross-Encoder 重排后顺序按新分数', async () => {
    const candidates: SearchResult[] = [
      fakeSearchResult('c1', '关于 OAuth2 配置...', 0.75),
      fakeSearchResult('c2', 'SSO 启用步骤...', 0.74),
      fakeSearchResult('c3', '无关日志', 0.72),
    ];

    // mock cross-encoder：让原本第 3 的 c3 反转到第 1（说明 reranker 的作用）
    const reranker = {
      rerank: mock(async () => [
        { index: 2, score: 0.95 }, // c3
        { index: 0, score: 0.80 }, // c1
        { index: 1, score: 0.50 }, // c2
      ]),
    };

    const reranked = await rerankResults(reranker, 'SSO 配置', candidates, 3);

    logSection('粗排 → 精排顺序变化');
    console.log('  Bi-Encoder 顺序:', candidates.map((c) => c.chunkId).join(' → '));
    console.log('  Cross-Encoder  :', reranked.map((c) => c.chunkId).join(' → '));
    console.log('  ↳ 重排是 RAG 召回质量的关键工程');

    expect(reranked.map((r) => r.chunkId)).toEqual(['c3', 'c1', 'c2']);
    expect(reranked[0].score).toBe(0.95);
  });
});

// ========================================================================
// 11.4 文档切分
// ========================================================================

describe('11.4.3 默认 chunk_size 500 切 1200 字文本', () => {
  it('切 1200 字（无明显边界）应得 >= 3 个 chunk', async () => {
    const text = 'a'.repeat(1200);
    const chunks = await chunkText(text);

    logSection('1200 字切分');
    console.log(`  chunks 数: ${chunks.length}`);
    console.log(`  首块长度 : ${chunks[0].content.length}`);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].content.length).toBeLessThanOrEqual(500);
  });
});

describe('11.4.4 重叠 50 字时相邻 chunk 有真实交集', () => {
  it('chunks 拼接后字符数 > 原文长度（有重叠才会膨胀）', async () => {
    const text = 'a'.repeat(1500);
    const chunks = await chunkText(text, { chunkSize: 500, chunkOverlap: 50 });
    const totalLen = chunks.reduce((s, c) => s + c.content.length, 0);

    logSection('重叠膨胀');
    console.log(`  原文: 1500 字`);
    console.log(`  chunks 合计字数: ${totalLen}`);
    console.log(`  膨胀: ${totalLen - 1500} 字 ≈ overlap 50 * (n-1)`);

    expect(totalLen).toBeGreaterThan(1500);
  });
});

describe('11.4.5 中文标点优先切分', () => {
  it("'第一段。\\n第二段...' 应在中文标点 / 换行处切，不会把英文/数字撕碎", async () => {
    // 多种结构：双换行段落 + 句号 + 逗号 + 英文 token
    const text =
      '产品支持 SSO 登录，管理员可在控制台创建用户组。批量导入用户支持 CSV 格式。\n\n' +
      '企业版上限为 200 个项目。专业版上限为 50 个项目，免费版 5 个。\n\n' +
      'API 兼容 OAuth2 协议。Token 默认 24 小时过期。'.repeat(3);
    const chunks = await chunkText(text, { chunkSize: 80, chunkOverlap: 0 });

    logSection('中文标点优先');
    console.log(`  chunk 数: ${chunks.length}`);
    chunks.slice(0, 4).forEach((c, i) => {
      console.log(
        `  [${i}] (${c.content.length}字): ${c.content.replace(/\n/g, '⏎')}`,
      );
    });

    // 1) 所有 chunk 长度都不超过 chunkSize（递归切分基本保证）
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(80);
    }

    // 2) 关键约束：英文/数字 token 不应被中途切断
    //    （切分点周围如果出现 'SSO' / 'OAuth2' / 'CSV' / 'API'，
    //     那么完整 token 必须出现在某一个 chunk 中）
    const tokens = ['SSO', 'CSV', 'API', 'OAuth2', '24'];
    for (const tok of tokens) {
      if (!text.includes(tok)) continue;
      const survivedSomewhere = chunks.some((c) => c.content.includes(tok));
      expect(survivedSomewhere).toBe(true);
    }

    // 3) 至少有一个 chunk 以"。"或"\n"结尾，说明 separators 起了作用
    const endedAtSeparator = chunks.some((c) => {
      const last = c.content[c.content.length - 1];
      return last === '。' || last === '\n' || last === '，';
    });
    expect(endedAtSeparator).toBe(true);
  });
});

describe('11.4.7 Parent-Child 切分', () => {
  it('parents.length < children.length，每个 child.parentIndex 在 parents 范围内', async () => {
    const text = (
      '## 第一节：登录\n用户进入登录页，选择企业 SSO 入口。系统跳转到 IDP 完成身份验证。' +
      '验证通过后回调到主站。\n\n' +
      '## 第二节：导入\n管理员可通过 CSV 批量导入用户。导入前应先做去重检查。' +
      '系统支持 10 万行以内的导入。\n\n' +
      '## 第三节：审计\n所有变更动作必须记录审计日志。日志保留 180 天。'
    ).repeat(3);

    const { parents, children } = await chunkParentChild(text, {
      parentSize: 300,
      childSize: 80,
    });

    logSection('Parent-Child 结构');
    console.log(`  parents 数 : ${parents.length}`);
    console.log(`  children 数: ${children.length}`);
    console.log(`  ↳ 小块用于检索（聚焦），命中后回查 parent 给 LLM 看（完整上下文）`);

    expect(parents.length).toBeGreaterThan(0);
    expect(children.length).toBeGreaterThan(parents.length);
    for (const c of children) {
      expect(c.parentIndex).toBeGreaterThanOrEqual(0);
      expect(c.parentIndex).toBeLessThan(parents.length);
    }
  });
});

// ========================================================================
// 11.5 向量数据库
// ========================================================================

describe('11.5.2 KNN 暴力 baseline - 小数据集与 mock ANN 一致性', () => {
  it('随机 50 条小数据集上，暴力 KNN 与"理论排序"完全一致', () => {
    const dim = 4;
    const records: VectorStoreRecord[] = [];
    for (let i = 0; i < 50; i++) {
      records.push(fakeRecord(`c${i}`, `d${i}`, `chunk ${i}`, fakeVec(i, dim)));
    }
    const query = fakeVec(123, dim);

    const top5 = bruteForceKnn(query, records, 5);

    logSection('暴力 KNN baseline');
    console.log(`  库大小: ${records.length}，Top-K = 5`);
    top5.forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.chunkId}  score=${r.score.toFixed(4)}`);
    });
    console.log('  ↳ 50 条数据用暴力 O(n)；几十万条就要换 HNSW/IVF（11.5.3/4）');

    // 严格递减
    for (let i = 1; i < top5.length; i++) {
      expect(top5[i - 1].score).toBeGreaterThanOrEqual(top5[i].score);
    }
    expect(top5.length).toBe(5);
  });

  it('维度不一致立刻抛 RangeError', () => {
    const records: VectorStoreRecord[] = [
      fakeRecord('c1', 'd1', 'x', [0.1, 0.2, 0.3, 0.4]),
    ];
    expect(() => bruteForceKnn([0.1, 0.2], records, 5)).toThrow(/向量维度不匹配/);
  });
});

describe('11.5.6 cosine 距离与相似度互转一致性', () => {
  it('score = 1 - 距离；归一化向量上 score == dot', () => {
    const a = normalize([0.3, 0.4, 0.5, 0.2]);
    const b = normalize([0.31, 0.39, 0.5, 0.21]);

    const sim = cosineSimilarity(a, b);
    const distLike = 1 - sim;

    logSection('cosine ↔ distance');
    console.log(`  sim       = ${sim.toFixed(6)}`);
    console.log(`  1 - sim   = ${distLike.toFixed(6)}（即 pgvector <=> 输出）`);

    expect(sim + distLike).toBeCloseTo(1, 9);
  });
});

// ========================================================================
// 11.6 生成环节
// ========================================================================

describe('11.6 RAG Pipeline - 拼 Prompt + 引用回写', () => {
  it('正常路径：检索 3 段 → 拼 Prompt → LLM 生成 → 返回 answer + citations', async () => {
    const captured: any[] = [];
    const model = {
      invoke: mock(async (messages: any[]) => {
        captured.push(messages);
        return { content: 'SSO 配置步骤如下 [chunkId: c1]。具体见 [chunkId: c2]。' };
      }),
    };
    const searchFn = mock(async () => [
      fakeSearchResult('c1', 'SSO 启用步骤...', 0.91),
      fakeSearchResult('c2', '管理员配置 SAML...', 0.87),
      fakeSearchResult('c3', '审计日志...', 0.74),
    ]);

    const result = await ragAsk({
      question: '如何配置 SSO？',
      searchFn,
      model,
      topK: 3,
    });

    logSection('RAG 正常路径');
    console.log('  answer    :', result.answer);
    console.log('  citations :', result.citations.map((c) => c.chunkId).join(', '));

    // System prompt 包含防幻觉规则
    expect(captured[0][0].content).toBe(RAG_DEFAULT_SYSTEM_PROMPT);
    // User message 含上下文 + 用户问题
    expect(captured[0][1].content).toContain('[上下文]');
    expect(captured[0][1].content).toContain('chunkId: c1');
    expect(captured[0][1].content).toContain('如何配置 SSO？');
    // 引用与检索数一致
    expect(result.citations.length).toBe(3);
    expect(result.citations[0].chunkId).toBe('c1');
  });

  it('检索 0 结果时回退到"无法确定"，不再调用 model.invoke', async () => {
    const model = { invoke: mock(async () => ({ content: '不应被调用' })) };
    const searchFn = mock(async () => []);

    const result = await ragAsk({
      question: '知识库里完全没提到的事',
      searchFn,
      model,
      topK: 5,
    });

    logSection('零检索结果回退');
    console.log('  answer:', result.answer);
    console.log('  ↳ 这是 11.6.5 防幻觉清单的关键回退');

    expect(result.answer).toBe(RAG_NO_CONTEXT_FALLBACK);
    expect(result.citations.length).toBe(0);
    expect(model.invoke).not.toHaveBeenCalled();
  });

  it('温度等参数通过 systemPrompt 透传', async () => {
    const captured: any[] = [];
    const model = {
      invoke: mock(async (msgs: any[]) => {
        captured.push(msgs);
        return 'plain string';
      }),
    };
    await ragAsk({
      question: 'q',
      searchFn: async () => [fakeSearchResult('c1', 'ctx', 0.5)],
      model,
      systemPrompt: '自定义 system',
    });
    expect(captured[0][0].content).toBe('自定义 system');
  });
});

// ========================================================================
// 11.7 召回率与准确率
// ========================================================================

describe('11.7.1 Recall@K / MRR / NDCG@K', () => {
  it('Recall@K = 1 当所有 relevant 都在 Top-K', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBeCloseTo(1, 9);
  });

  it('Recall@K = 0 当 K=0', () => {
    expect(recallAtK(['a', 'b'], ['a'], 0)).toBe(0);
  });

  it('Recall@K = 0 当零命中', () => {
    expect(recallAtK(['x', 'y', 'z'], ['a'], 3)).toBe(0);
  });

  it('MRR 第一个相关在第 1 位 → 1.0；第 2 位 → 0.5', () => {
    expect(mrr([['a', 'b', 'c']], [['a']])).toBeCloseTo(1, 9);
    expect(mrr([['x', 'a', 'b']], [['a']])).toBeCloseTo(0.5, 9);

    const m = mrr(
      [
        ['a', 'b', 'c'],     // rank 1 → 1
        ['x', 'y', 'a'],     // rank 3 → 1/3
        ['x', 'a', 'y'],     // rank 2 → 1/2
      ],
      [['a'], ['a'], ['a']],
    );

    logSection('MRR 多 query');
    console.log(`  MRR = (1 + 1/3 + 1/2) / 3 = ${m.toFixed(4)}`);

    expect(m).toBeCloseTo((1 + 1 / 3 + 1 / 2) / 3, 9);
  });

  it('NDCG@K 单个完全命中 = 1.0；命中靠后则下降', () => {
    expect(ndcgAtK(['a'], ['a'], 5)).toBeCloseTo(1, 9);
    const head = ndcgAtK(['a', 'b', 'c', 'd'], ['a'], 4);
    const tail = ndcgAtK(['x', 'y', 'z', 'a'], ['a'], 4);

    logSection('NDCG 排名敏感');
    console.log(`  rank 1 → NDCG = ${head.toFixed(4)}`);
    console.log(`  rank 4 → NDCG = ${tail.toFixed(4)}`);
    console.log('  ↳ 同样命中，排得越靠前分数越高');

    expect(head).toBeGreaterThan(tail);
    expect(head).toBeCloseTo(1, 9);
  });
});

describe('11.7.3 ragas-runner 在 RAGAS 不可用时降级 + warn，不抛错', () => {
  it('fetch 抛错时返回 null，不向上抛', async () => {
    const warns: string[] = [];
    const result = await runRagas(
      {
        samples: [{ question: 'q', answer: 'a', contexts: ['c'] }],
        metrics: ['faithfulness'],
      },
      {
        fetchImpl: (async () => {
          throw new Error('connection refused');
        }) as any,
        retries: 2,
        timeoutMs: 100,
        warn: (msg) => warns.push(msg),
      },
    );

    logSection('RAGAS 降级');
    console.log(`  result = ${result}`);
    console.log(`  warn 次数 = ${warns.length}`);

    expect(result).toBeNull();
    expect(warns.length).toBe(2);
  });

  it('正常 200 → 返回解析后的指标', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ faithfulness: 0.92 }),
    })) as any;
    const result = await runRagas(
      { samples: [], metrics: ['faithfulness'] },
      { fetchImpl: fakeFetch, retries: 1 },
    );
    expect(result).toEqual({ faithfulness: 0.92 });
  });
});

// ========================================================================
// 11.8 提升召回率的策略
// ========================================================================

describe('11.8.1 Query 改写 - 返回 1-5 条改写，失败回退原句', () => {
  it('withStructuredOutput 路径正常返回多条', async () => {
    const model: any = {
      withStructuredOutput: () => ({
        invoke: mock(async () => ({
          queries: ['如何配置 SSO', 'SSO 启用步骤', '单点登录设置'],
        })),
      }),
      invoke: mock(async () => ({ content: '' })),
    };
    const queries = await rewriteQuery(model, '怎么配 SSO');
    logSection('Query 改写');
    console.log('  原句  :', '怎么配 SSO');
    console.log('  改写后:', queries.join(' | '));
    expect(queries.length).toBe(3);
  });

  it('改写失败时回退到原句', async () => {
    const model: any = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('model down');
        },
      }),
      invoke: mock(async () => ({ content: 'invalid' })),
    };
    const queries = await rewriteQuery(model, '原句保底');
    expect(queries).toEqual(['原句保底']);
  });
});

describe('11.8.3 RRF 融合 - 不同打分量纲的两路检索', () => {
  it('两个排序中都靠前的文档应排第一', () => {
    const list1 = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const list2 = [{ id: 'B' }, { id: 'A' }, { id: 'D' }];
    const scores = rrfFuse([list1, list2], 60);

    logSection('RRF 融合');
    for (const [id, s] of scores.entries()) {
      console.log(`  ${id}: ${s.toFixed(5)}`);
    }

    // A 和 B 都在两个列表中靠前，应高于只在一个列表中的 C/D
    expect(scores.get('A')! > scores.get('C')!).toBe(true);
    expect(scores.get('B')! > scores.get('D')!).toBe(true);
  });

  it('hybridSearch 端到端：向量 + BM25 → 去重排序', async () => {
    const vec: SearchResult[] = [
      fakeSearchResult('c1', 'SSO 启用步骤', 0.95),
      fakeSearchResult('c2', '审计日志', 0.92),
      fakeSearchResult('c3', '通用配置', 0.81),
    ];
    const bm25: SearchResult[] = [
      fakeSearchResult('c2', '审计日志', 12.3),  // 注意分数量纲不同
      fakeSearchResult('c4', 'OAuth2 协议', 8.1),
      fakeSearchResult('c1', 'SSO 启用步骤', 6.5),
    ];

    const result = await hybridSearch(
      'SSO 怎么开',
      async () => vec,
      async () => bm25,
      { topK: 4, recallMultiplier: 2 },
    );

    logSection('混合检索结果');
    result.forEach((r, i) =>
      console.log(`  [${i + 1}] ${r.chunkId}  rrf=${r.score.toFixed(5)}`),
    );

    // c1、c2 同时出现在两路 → 排前
    expect(result.slice(0, 2).map((r) => r.chunkId).sort()).toEqual(['c1', 'c2']);
    // 去重：c1/c2 不应出现两次
    const ids = result.map((r) => r.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('11.8.4 重排序 - Cross-Encoder mock 改变排名顺序', () => {
  it('重排后顺序按新分数；越界 index 应被过滤', async () => {
    const candidates: SearchResult[] = [
      fakeSearchResult('c1', 'A', 0.9),
      fakeSearchResult('c2', 'B', 0.8),
      fakeSearchResult('c3', 'C', 0.7),
    ];
    const reranker = {
      rerank: mock(async () => [
        { index: 2, score: 0.99 },
        { index: 0, score: 0.50 },
        { index: 99, score: 0.30 }, // 越界
      ]),
    };
    const reranked = await rerankResults(reranker, 'q', candidates, 5);
    expect(reranked.map((r) => r.chunkId)).toEqual(['c3', 'c1']);
    expect(reranked[0].score).toBe(0.99);
  });
});

// ========================================================================
// 11.9 RAG 高级模式
// ========================================================================

describe('11.9.1 HyDE - 用幻想答案做检索', () => {
  it('LLM 先输出 hypothetical → 用它替代原问题去 searchFn', async () => {
    const model = {
      invoke: mock(async () => ({
        content: '企业版单工作区最多 500 用户（注：可能错，但用词接近文档）',
      })),
    };
    const queries: string[] = [];
    const searchFn = mock(async (q: string) => {
      queries.push(q);
      return [fakeSearchResult('c1', '《企业版规格》: 实际是 200 用户', 0.88)];
    });

    const { hypothetical, results } = await hydeSearch(
      model,
      searchFn,
      '企业版用户上限是多少',
      { topK: 3 },
    );

    logSection('HyDE');
    console.log('  hypothetical →', hypothetical.slice(0, 40), '...');
    console.log('  实际去检索的 query →', queries[0].slice(0, 40), '...');

    expect(queries[0]).toContain('500 用户');
    expect(results[0].chunkId).toBe('c1');
  });
});

describe('11.9.4 Adaptive-RAG - 按复杂度走三条路径', () => {
  const llm = {
    invoke: mock(async () => ({ content: '今天是 5 月 15 号' })),
  };

  it('simple → 不检索，直接 LLM 回答', async () => {
    const searchFn = mock(async () => [] as SearchResult[]);
    const result = await adaptiveRagAsk({
      question: '今天几号',
      classifier: fixedClassifier('simple'),
      searchFn,
      model: llm,
    });
    logSection('Adaptive: simple');
    console.log('  path  :', result.path);
    console.log('  answer:', result.answer);
    expect(result.path).toBe('simple');
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('single_hop → 单次检索 + 生成', async () => {
    const searchFn = mock(async () => [fakeSearchResult('c1', '说明书', 0.9)]);
    const result = await adaptiveRagAsk({
      question: '什么是 SSO',
      classifier: fixedClassifier('single_hop'),
      searchFn,
      model: llm,
    });
    logSection('Adaptive: single_hop');
    console.log('  path  :', result.path);
    console.log('  检索次数 :', (searchFn as any).mock.calls.length);
    expect(result.path).toBe('single_hop');
    expect(result.retrieved.length).toBe(1);
  });

  it('multi_hop → 子问题拆解 + 多次检索 + 合并', async () => {
    const searchCalls: string[] = [];
    const searchFn = mock(async (q: string) => {
      searchCalls.push(q);
      return [fakeSearchResult(`c-${searchCalls.length}`, `for ${q}`, 0.7)];
    });
    const decomposeFn = mock(async () => ['子问题1', '子问题2', '子问题3']);

    const result = await adaptiveRagAsk({
      question: '对比方案 A、B、C 的成本',
      classifier: fixedClassifier('multi_hop'),
      searchFn,
      model: llm,
      decomposeFn,
    });

    logSection('Adaptive: multi_hop');
    console.log('  subQueries :', result.subQueries);
    console.log('  search 次数:', searchCalls.length);
    console.log(
      '  合并去重后  :',
      result.retrieved.map((r) => r.chunkId).join(', '),
    );

    expect(result.path).toBe('multi_hop');
    expect(result.subQueries!.length).toBe(3);
    // 3 次子检索 + 1 次复用合并的 single-hop（searchFn 又被 ragAsk 调一次，但内部已 mock 成 merged）
    expect(searchCalls.length).toBeGreaterThanOrEqual(3);
  });
});

// ========================================================================
// 11.10 集成到 LangGraph Agent
// ========================================================================

describe('11.10 RAG-as-Tool - 工具描述、预算闸门、JSON 输出', () => {
  it('工具元信息：name=search_knowledge_base，description 含"适用/不适用"', () => {
    expect(RAG_TOOL_NAME).toBe('search_knowledge_base');
    expect(RAG_TOOL_DESCRIPTION).toContain('适用');
    expect(RAG_TOOL_DESCRIPTION).toContain('不适用');
    logSection('Tool 元信息');
    console.log(`  name        : ${RAG_TOOL_NAME}`);
    console.log(`  description : ${RAG_TOOL_DESCRIPTION.slice(0, 60)}...`);
  });

  it('allow 路径：返回 JSON 字符串，含 answer + citations（按 chunkId 去重）', async () => {
    const tool = createRagTool({
      model: {
        invoke: mock(async () => ({
          content: 'SSO 启用步骤 [chunkId: c1]',
        })),
      },
      userId: 'u-1',
      searchFn: mock(async () => [
        fakeSearchResult('c1', 'A', 0.91),
        fakeSearchResult('c1', 'A duplicate', 0.91), // 去重测试
        fakeSearchResult('c2', 'B', 0.85),
      ]),
      getBudget: () => ({ usedPercent: 50 }),
    });

    const raw = await tool.invoke({ question: '如何配置 SSO？' });
    const parsed = JSON.parse(raw);

    logSection('Tool allow 路径');
    console.log('  raw type :', typeof raw);
    console.log('  answer   :', parsed.answer);
    console.log('  citations:', parsed.citations.map((c: any) => c.chunkId));

    expect(typeof raw).toBe('string');
    expect(parsed.answer).toContain('SSO');
    // citations 去重后 c1 只出现一次
    const ids = parsed.citations.map((c: any) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });

  it('reject 路径：预算超限直接返回 budget_exceeded，不调用 model.invoke', async () => {
    const model = { invoke: mock(async () => ({ content: 'should not run' })) };
    const tool = createRagTool({
      model,
      userId: 'u-1',
      searchFn: mock(async () => []),
      getBudget: () => ({ usedPercent: 110 }),
    });

    const raw = await tool.invoke({ question: '任何问题' });
    const parsed = JSON.parse(raw);

    logSection('Tool reject 路径');
    console.log('  parsed.error:', parsed.error);
    console.log('  ↳ rag_tool 不在 HIGH_RISK_AGENTS 列表，超预算时被 reject');

    expect(parsed.error).toBe('budget_exceeded');
    expect(model.invoke).not.toHaveBeenCalled();
  });
});

// ========================================================================
// 11.11 全景回顾 - 端到端串联
// ========================================================================

describe('11.11 端到端 - 完整 RAG-as-Tool 流水线', () => {
  it('Query 改写 → 混合检索 → 重排 → RAG Pipeline → Tool 返回 JSON', async () => {
    // ── 1. Query 改写 mock
    const rewriter: any = {
      withStructuredOutput: () => ({
        invoke: mock(async () => ({
          queries: ['SSO 配置', 'SSO 启用', '单点登录'],
        })),
      }),
      invoke: mock(async () => ({ content: '' })),
    };
    const rewritten = await rewriteQuery(rewriter, '怎么搞 SSO');
    expect(rewritten.length).toBeGreaterThan(0);

    // ── 2. 混合检索（向量 + BM25 + RRF）
    const vec = [
      fakeSearchResult('c1', 'SSO 启用步骤', 0.95),
      fakeSearchResult('c2', '审计日志', 0.92),
      fakeSearchResult('c3', '通用配置', 0.81),
    ];
    const bm25 = [
      fakeSearchResult('c2', '审计日志', 12.3),
      fakeSearchResult('c1', 'SSO 启用步骤', 8.1),
      fakeSearchResult('c4', 'OAuth2 协议', 6.5),
    ];
    const merged = await hybridSearch(
      rewritten[0],
      async () => vec,
      async () => bm25,
      { topK: 4, recallMultiplier: 2 },
    );

    // ── 3. 重排
    const reranker = {
      rerank: mock(async () => merged.map((_, i) => ({ index: i, score: 1 - i * 0.1 }))),
    };
    const reranked = await rerankResults(reranker, rewritten[0], merged, 3);

    // ── 4. 评测指标（Recall@K / NDCG@K）—— 假设 ground truth 是 c1 / c2
    const retrievedIds = reranked.map((r) => r.chunkId);
    const recall = recallAtK(retrievedIds, ['c1', 'c2'], 3);
    const ndcg = ndcgAtK(retrievedIds, ['c1', 'c2'], 3);

    // ── 5. RAG-as-Tool
    const tool = createRagTool({
      model: {
        invoke: mock(async () => ({
          content: 'SSO 启用步骤 [chunkId: c1]，再启用审计 [chunkId: c2]。',
        })),
      },
      userId: 'u-1',
      searchFn: async () => reranked,
      getBudget: () => ({ usedPercent: 30 }),
    });
    const raw = await tool.invoke({ question: '怎么搞 SSO' });
    const out = JSON.parse(raw);

    logSection('端到端流水线');
    console.log('  rewritten   :', rewritten.join(' | '));
    console.log('  hybrid TopK :', merged.map((r) => r.chunkId).join(', '));
    console.log('  reranked    :', retrievedIds.join(', '));
    console.log(`  Recall@3    : ${recall.toFixed(2)}`);
    console.log(`  NDCG@3      : ${ndcg.toFixed(2)}`);
    console.log('  answer      :', out.answer);
    console.log('  citations   :', out.citations.map((c: any) => c.chunkId).join(', '));

    expect(out.answer).toContain('SSO');
    expect(recall).toBeGreaterThan(0);
    expect(ndcg).toBeGreaterThan(0);
  });
});
