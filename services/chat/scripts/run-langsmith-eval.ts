/**
 * run-langsmith-eval.ts
 *
 * 在 LangSmith 上跑 Experiment：读 Dataset → target 函数跑真实图 → evaluators 打分。
 * 跑完后在 LangSmith UI 可视化查看每个 case 的 trace、分数、评语。
 *
 * 前置：
 *   1. .env 配好 LANGSMITH_API_KEY / OPENAI_API_KEY / OPENAI_BASE_URL
 *   2. 先跑 sync-langsmith-dataset.ts 上传数据集
 *
 * 运行：
 *   cd services/chat
 *   bun run scripts/run-langsmith-eval.ts                         # 默认
 *   bun run scripts/run-langsmith-eval.ts --prefix=topK8-test     # 自定义实验名
 */
import { evaluate } from 'langsmith/evaluation';
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph';
import { judgeReport } from '../eval/judge';
import { recallAtK, precisionAtK } from '../rag/evaluation/retrieval-metrics';

config({ path: new URL('../.env', import.meta.url).pathname });

const DATASET_NAME = 'autix-requirement-analysis';

function getPrefix(): string {
  const arg = process.argv.find((a) => a.startsWith('--prefix='));
  return arg ? arg.split('=')[1] : `eval-${new Date().toISOString().slice(0, 10)}`;
}

async function main() {
  for (const key of ['LANGSMITH_API_KEY', 'OPENAI_API_KEY']) {
    if (!process.env[key]) {
      console.error(`❌ 缺少 ${key}，请先在 .env 中配置`);
      process.exit(1);
    }
  }

  const model = new ChatOpenAI({
    model: process.env.LLM_MODEL || process.env.LLM_OBS_TEST_MODEL || 'gpt-4o',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prefix = getPrefix();
  console.log(`▶ 开始 LangSmith Experiment: ${prefix}`);
  console.log(`  Dataset: ${DATASET_NAME}`);
  console.log(`  Model: ${model.model}`);

  // target：拿 example inputs 跑真实分析图
  async function target(inputs: { input: string }) {
    const out = await runAnalysisGraph({
      input: inputs.input,
      retrievedContext: '（LangSmith 评测模式：无检索上下文，测试纯生成能力）',
      model,
    });
    return {
      intent: out.intent,
      summary: out.summary ?? '',
    };
  }

  // evaluator 1：LLM-as-judge 报告质量（复用 eval/judge.ts）
  async function reportQuality({
    outputs,
  }: {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
  }) {
    if (!outputs?.summary) return { key: 'report_quality', score: 0, comment: '无报告' };
    const j = await judgeReport(model, outputs.summary);
    return {
      key: 'report_quality',
      score: j.totalScore / 100,
      comment: `总分${j.totalScore} | ${j.critique}`,
    };
  }

  // evaluator 2：triage 准确率（确定性）
  function intentMatch({
    outputs,
    referenceOutputs,
  }: {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
  }) {
    if (!referenceOutputs?.expectedIntent) return { key: 'intent_correct', score: null };
    return {
      key: 'intent_correct',
      score: outputs?.intent === referenceOutputs.expectedIntent ? 1 : 0,
    };
  }

  // evaluator 3：报告长度（辅助指标，帮助发现"空报告"或"过度冗长"）
  function reportLength({
    outputs,
  }: {
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    referenceOutputs?: Record<string, any>;
  }) {
    const len = (outputs?.summary ?? '').length;
    return {
      key: 'report_length',
      score: len > 0 ? Math.min(len / 2000, 1) : 0,
      comment: `${len} 字`,
    };
  }

  const results = await evaluate(target, {
    data: DATASET_NAME,
    evaluators: [reportQuality, intentMatch, reportLength],
    experimentPrefix: prefix,
    maxConcurrency: 2,
    metadata: {
      model: model.model,
      gitSha: process.env.GIT_SHA ?? 'local',
      chapter: '17',
    },
  });

  console.log('\n✅ Experiment 完成！');
  console.log('   打开 LangSmith UI 查看结果：');
  console.log(`   https://smith.langchain.com → Datasets → ${DATASET_NAME} → Experiments`);
  console.log(`   实验名前缀：${prefix}`);
}

main().catch((err) => {
  console.error('eval 失败：', err.message ?? err);
  process.exit(1);
});
