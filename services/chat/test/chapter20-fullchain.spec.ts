/**
 * chapter20-fullchain.spec.ts
 *
 * 第二十章《满血版链路》配套用例。
 *
 * Layer 1（零 LLM、确定性）：验证六个接线点的纯逻辑——长链路由判定、检索上下文注入、
 *   MCP 降级、hybrid 检索后端（BM25/RRF/embedding 重排）。这些每次 CI 都跑。
 * Layer 2（需 OPENAI_API_KEY，长超时）：用真实 LLM 端到端验证「真生效」——
 *   RAG 修复后报告真正消费检索内容、长链输入路由到 DeepAgent 并产出。无 key 自动跳过。
 *
 * 运行：
 *   bun test test/chapter20-fullchain.spec.ts            # 只有 Layer 1（无 key）
 *   OPENAI_API_KEY=... bun test test/chapter20-fullchain.spec.ts  # 含 Layer 2
 */
import { describe, it, expect } from 'bun:test';
import { config } from 'dotenv';
import { detectLongChain, OrchestratorService } from '../src/llm/agents/orchestrator.service';
import { buildRetrievedContextBlock, runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph';
import { getExpertTools } from '../src/llm/graph/experts';
import {
  tokenize,
  bm25Search,
  hybridSearch,
  embeddingRerank,
  type RetrievalResult,
} from '../src/document/hybrid-retrieval';

config({ path: new URL('../.env', import.meta.url).pathname });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const SKIP = !OPENAI_API_KEY;
if (SKIP) {
  console.warn('⚠️  OPENAI_API_KEY 未设置，第二十章 Layer 2 端到端用例将跳过');
}

const mkDoc = (id: string, content: string): RetrievalResult => ({
  chunkId: id,
  documentId: 'd-' + id,
  content,
  chunkIndex: 0,
  score: 0,
});

// ===========================================================================
// Layer 1（零 LLM、确定性）
// ===========================================================================

describe('20.6 长链路由 detectLongChain', () => {
  it('多工单输入（≥2 个不同 REQ）路由到 DeepAgent', () => {
    expect(detectLongChain('评估 REQ-001/REQ-002/REQ-003 的总体影响')).toBe(true);
    expect(detectLongChain('REQ-1 和 REQ-2 有冲突吗')).toBe(true);
  });

  it('单需求 / 单 REQ / 重复同一 REQ 路由到主图', () => {
    expect(detectLongChain('加个登录功能')).toBe(false);
    expect(detectLongChain('看下 REQ-001 的状态')).toBe(false);
    expect(detectLongChain('REQ-001 又是 REQ-001')).toBe(false); // 去重后仅 1 个
  });
});

describe('20.3 检索上下文注入 buildRetrievedContextBlock', () => {
  it('空 / 占位文本不注入（返回空串，不污染 prompt）', () => {
    expect(buildRetrievedContextBlock('')).toBe('');
    expect(buildRetrievedContextBlock(undefined)).toBe('');
    expect(buildRetrievedContextBlock('无相关参考文档')).toBe('');
  });

  it('有检索内容时注入「参考资料」块并带上原文', () => {
    const block = buildRetrievedContextBlock('企业微信登录走 OAuth2 授权码模式');
    expect(block).toContain('参考资料');
    expect(block).toContain('OAuth2 授权码');
  });
});

describe('20.4 MCP 降级（未连接时退回 Mock 工具）', () => {
  it('MCP 未连接时 getExpertTools 只返回该领域 Mock 工具，不抛错', () => {
    // 测试进程从不调用 initMcp → mcpManager.getTools()=[] → 纯 Mock
    const security = getExpertTools('security').map((t) => t.name);
    expect(security).toEqual(['check_security_policy', 'list_auth_scenarios']);

    const functional = getExpertTools('functional').map((t) => t.name);
    expect(functional).toHaveLength(3);
    // 未连接时不应出现任何 MCP 工具名
    expect(functional).not.toContain('analyze_completeness');
    expect(functional).not.toContain('web_search');
  });

  it('未知领域返回空数组（默认 deny 思路，不抛错）', () => {
    expect(getExpertTools('unknown-domain')).toEqual([]);
  });
});

describe('20.2 hybrid 检索后端（纯函数、零数据模型变更）', () => {
  it('tokenize 中英混合：latin 按词、CJK 按单字', () => {
    expect(tokenize('OAuth2 企业微信')).toEqual(['oauth2', '企', '业', '微', '信']);
    expect(tokenize('')).toEqual([]);
  });

  it('bm25Search 把命中查询词的文档排前面', () => {
    const corpus = [
      mkDoc('a', '企业微信登录需要 OAuth2 授权码模式'),
      mkDoc('b', '今天天气不错适合散步'),
      mkDoc('c', '微信支付与账单结算'),
    ];
    const ranked = bm25Search('企业微信 OAuth2', corpus, 3);
    expect(ranked[0].chunkId).toBe('a'); // 命中最多查询词
    expect(ranked.find((r) => r.chunkId === 'b')).toBeUndefined(); // 零命中被过滤
  });

  it('hybridSearch 用 RRF 融合两路、去重、截到 topK', async () => {
    const vector = async () => [mkDoc('a', 'x'), mkDoc('b', 'y')];
    const bm25 = async () => [mkDoc('b', 'y'), mkDoc('c', 'z')];
    const fused = await hybridSearch('q', vector, bm25, 3);
    const ids = fused.map((r) => r.chunkId).sort();
    expect(ids).toEqual(['a', 'b', 'c']); // 三个去重候选
    expect(fused[0].chunkId).toBe('b'); // b 在两路都靠前 → RRF 分最高
  });

  it('embeddingRerank 按 query 余弦相似度精排', async () => {
    const candidates = [mkDoc('a', 'aaa'), mkDoc('b', 'bbb')];
    // query=[1,0]；a=[0,1]（cos 0）、b=[1,0]（cos 1）→ b 应排第一
    const embed = async (_texts: string[]) => [
      [1, 0],
      [0, 1],
      [1, 0],
    ];
    const reranked = await embeddingRerank('q', candidates, embed, 2);
    expect(reranked[0].chunkId).toBe('b');
  });
});

// ===========================================================================
// Layer 2（需 OPENAI_API_KEY，真实 LLM 端到端）
// ===========================================================================

describe('20.3 RAG 修复后，报告真正消费检索内容（Layer 2）', () => {
  if (SKIP) {
    it.skip('需要 OPENAI_API_KEY 环境变量', () => {});
    return;
  }

  it(
    '报告里出现知识库特有术语，证明 retrievedContext 被报告消费',
    async () => {
      const { createChatModel } = await import('../src/llm/model.factory');
      const { loadLangChainConfig } = await import('../src/config/load-langchain-config');
      const cfg = loadLangChainConfig();
      const model = createChatModel({
        modelConfigId: 'default',
        modelName: cfg.llm.model,
        temperature: 0.2,
        maxTokens: cfg.llm.maxTokens,
        baseUrl: OPENAI_BASE_URL,
        apiKey: OPENAI_API_KEY,
      });

      // 植入一个特征性事实，报告若真消费检索内容就该出现这些术语
      const retrievedContext =
        '[知识库] 企业微信登录必须使用 OAuth2 授权码模式，并在回调时校验 corpId。';
      const result = await runAnalysisGraph({
        input:
          '为后台管理系统增加企业微信扫码登录：用户用企业微信授权登录，自动绑定已有账号，支持单点登出。',
        retrievedContext,
        model,
      });

      expect(result.summary).toBeTruthy();
      expect(result.summary).toMatch(/OAuth2|授权码|corpId/i);
    },
    180_000,
  );
});

describe('20.6 长链输入端到端路由到 DeepAgent 并产出（Layer 2）', () => {
  if (SKIP) {
    it.skip('需要 OPENAI_API_KEY 环境变量', () => {});
    return;
  }

  it(
    '多工单输入触发 DeepAgent 分支并返回非空报告',
    async () => {
      const orch = new OrchestratorService({} as never, {} as never);
      const input = '评估 REQ-001 与 REQ-002 的总体影响和冲突';
      expect(detectLongChain(input)).toBe(true);

      let routedToDeep = false;
      let report = '';
      for await (const ev of orch.streamOrchestrate(input, '无相关参考文档', undefined)) {
        if (ev.type === 'log' && ev.message.includes('DeepAgent')) routedToDeep = true;
        if (ev.type === 'final') report = ev.result.report ?? '';
      }
      expect(routedToDeep).toBe(true);
      expect(report.length).toBeGreaterThan(0);
    },
    300_000,
  );
});
