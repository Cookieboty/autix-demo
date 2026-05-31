/**
 * chapter17-eval.spec.ts
 *
 * 第十七章《评估流水线》配套测试
 *
 * Layer 1：零 LLM 依赖（确定性）
 *   - 检索指标：precisionAtK / recallAtK / ndcgAtK
 *   - 门禁：gateDecision 阈值判定 + 维度缺席不误判
 *   - 聚合：aggregate 按 tag 分桶、缺失维度不拉低均值
 *   - judge：加权总分在代码里算（不依赖 LLM 算术）、per-dimension 下限判定
 *   - loader：rubric 权重校验、数据集必填字段
 * Layer 2：真实 LLM（需 OPENAI_API_KEY 且 RUN_LLM_EVAL_TESTS=1）
 *   - judge 对"详实报告"给分明显高于"空泛水报告"
 *   - runAnalysisGraph 端到端跑 1 个 analyze case → intent 命中 + 报告非空
 *
 * 运行：bun test test/chapter17-eval.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { precisionAtK, recallAtK, ndcgAtK } from '../rag/evaluation/retrieval-metrics';
import {
  aggregate,
  gateDecision,
  type CaseResult,
} from '../rag/evaluation/aggregate';
import { judgeReport } from '../eval/judge';
import { loadRubric } from '../eval/rubric-loader';
import { loadDataset } from '../eval/dataset-loader';
import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph';

config({ path: new URL('../.env', import.meta.url).pathname });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RUN_LLM = process.env.RUN_LLM_EVAL_TESTS === '1';
const SKIP_LLM = !OPENAI_API_KEY || !RUN_LLM;

if (SKIP_LLM) {
  console.warn('⚠️  ch17 LLM 测试将跳过：需要 OPENAI_API_KEY 且 RUN_LLM_EVAL_TESTS=1');
}

/** mock 一个只实现 withStructuredOutput().invoke() 的模型，返回固定各维度分 */
function mockJudgeModel(
  dimensions: Array<{ dimensionId: string; score: number; reason: string }>,
): BaseChatModel {
  return {
    withStructuredOutput: () => ({
      invoke: async () => ({ dimensions, overallCritique: 'mock critique' }),
    }),
  } as unknown as BaseChatModel;
}

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('17.3 检索指标', () => {
  const retrieved = ['c1', 'c5', 'c3', 'c8', 'c9'];
  const relevant = ['c1', 'c3'];

  it('precisionAtK：返回 5 个命中 2 个 = 0.4（分母是返回数）', () => {
    expect(precisionAtK(retrieved, relevant, 5)).toBeCloseTo(0.4);
  });

  it('recallAtK：相关 2 个全命中 = 1.0（分母是相关总数）', () => {
    expect(recallAtK(retrieved, relevant, 5)).toBe(1);
  });

  it('precision 与 recall 同命中数下分母不同', () => {
    expect(precisionAtK(retrieved, relevant, 5)).not.toBe(recallAtK(retrieved, relevant, 5));
  });

  it('ndcgAtK：相关文档靠前 → 接近 1', () => {
    expect(ndcgAtK(['c1', 'c3', 'x', 'y'], ['c1', 'c3'], 4)).toBeCloseTo(1, 5);
  });

  it('边界：k<=0 或无相关文档时不抛错', () => {
    expect(precisionAtK(retrieved, relevant, 0)).toBe(0);
    expect(recallAtK(retrieved, [], 5)).toBe(0);
  });
});

describe('17.7 门禁判定', () => {
  function summaryWith(overall: Record<string, number>) {
    return aggregate([{ id: 'x', tags: ['t'], metrics: overall }]);
  }

  it('recall 低于阈值则 fail', () => {
    const s = summaryWith({ recall: 0.7, judgeScore: 80, intentCorrect: 0.95 });
    expect(gateDecision(s)).toBe(false);
  });

  it('全部达标则 pass', () => {
    const s = summaryWith({ recall: 0.85, judgeScore: 80, intentCorrect: 0.95 });
    expect(gateDecision(s)).toBe(true);
  });

  it('维度缺席（--no-llm 只有 recall）不因 judge/intent 缺失误判 fail', () => {
    const s = summaryWith({ recall: 0.9 });
    expect(gateDecision(s)).toBe(true);
  });
});

describe('17.7 aggregate 分桶', () => {
  const results: CaseResult[] = [
    { id: 'a', tags: ['typical', 'auth'], metrics: { recall: 1, intentCorrect: 1 } },
    { id: 'b', tags: ['typical'], metrics: { recall: 0.5, intentCorrect: 1 } },
    { id: 'c', tags: ['chat'], metrics: { intentCorrect: 0 } }, // 无检索指标
  ];

  it('按 tag 分桶 + 全量', () => {
    const s = aggregate(results);
    const typical = s.buckets.find((b) => b.bucket === 'typical')!;
    expect(typical.n).toBe(2);
    expect(typical.recall).toBeCloseTo(0.75);
    expect(s.overall.n).toBe(3);
  });

  it('缺失维度不拉低均值（chat 没有 recall，不算 0）', () => {
    const s = aggregate(results);
    // recall 只在 2 个有该指标的 case 上平均 = (1+0.5)/2
    expect(s.overall.recall).toBeCloseTo(0.75);
    // intentCorrect 三个都有 = (1+1+0)/3
    expect(s.overall.intentCorrect).toBeCloseTo(2 / 3);
  });
});

describe('17.5 judge 加权（总分在代码里算，不依赖 LLM 算术）', () => {
  const fullDims = (scores: Record<string, number>) =>
    Object.entries(scores).map(([dimensionId, score]) => ({ dimensionId, score, reason: 'r' }));

  it('各维度同分时加权总分 = 该分（权重和为 1）', async () => {
    const model = mockJudgeModel(
      fullDims({ completeness: 80, professionalism: 80, actionability: 80, consistency: 80 }),
    );
    const r = await judgeReport(model, '报告');
    expect(r.totalScore).toBe(80);
    expect(r.passed).toBe(true);
  });

  it('单维度低于 per-dimension 下限 → 即使总分达标也 fail', async () => {
    // completeness=50(<60)，其余 90：总分 = 50*.3+90*.25+90*.25+90*.2 = 78 >=75
    const model = mockJudgeModel(
      fullDims({ completeness: 50, professionalism: 90, actionability: 90, consistency: 90 }),
    );
    const r = await judgeReport(model, '报告');
    expect(r.totalScore).toBe(78);
    expect(r.passed).toBe(false); // 被 minPerDimension 卡住
  });
});

describe('17.5/17.6 loader 校验', () => {
  it('rubric 权重之和为 1，否则报错', () => {
    const rubric = loadRubric('requirement-analysis');
    const sum = rubric.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1);
    expect(rubric.gate.minScore).toBeGreaterThan(0);
  });

  it('数据集每个 case 有必填字段且 intent 合法', () => {
    const cases = loadDataset('requirement-analysis');
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.input).toBeTruthy();
      expect(['analyze', 'query', 'chat']).toContain(c.expectedIntent);
    }
  });
});

// ============================================================================
// Layer 2：真实 LLM
// ============================================================================

describe('17.5 judge 真实区分度（Layer 2）', () => {
  it.skipIf(SKIP_LLM)(
    '详实报告得分明显高于空泛水报告',
    async () => {
      const model = new ChatOpenAI({
        model: process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4',
        temperature: 0,
        configuration: { baseURL: process.env.OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY,
      });

      const goodReport = `# 企业微信扫码登录 需求分析
## 功能分解
1. 前端二维码渲染与轮询；2. 企业微信 code 回调换 userid；3. 首次登录用户绑定。
## 用户故事
作为员工，我希望用企业微信扫码一键登录，免去记密码。
## 验收标准
- 扫码 3 秒内完成登录；code 一次性、state 校验防 CSRF。
## 风险与依赖
依赖企业微信管理后台可信域名配置；需处理 code 过期与重复使用。
## 排期
前端 2 天 / 后端 3 天 / 联调 1 天。`;

      const waterReport = '这个需求很重要，我们应该认真做好，把登录功能做得更好用一些，提升用户体验。';

      const good = await judgeReport(model, goodReport);
      const water = await judgeReport(model, waterReport);
      expect(good.totalScore).toBeGreaterThan(water.totalScore);
    },
    600_000,
  );
});

describe('17.7 runner 端到端单 case（Layer 2）', () => {
  it.skipIf(SKIP_LLM)(
    'runAnalysisGraph 跑 analyze case → 报告非空',
    async () => {
      const model = new ChatOpenAI({
        model: process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4',
        temperature: 0,
        configuration: { baseURL: process.env.OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY,
      });

      const out = await runAnalysisGraph({
        input: '加个企业微信扫码登录功能',
        retrievedContext: '无相关参考文档',
        model,
      });
      expect(out.summary.length).toBeGreaterThan(0);
    },
    600_000,
  );
});
