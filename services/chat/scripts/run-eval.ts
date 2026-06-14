/**
 * run-eval.ts —— 统一评测 runner（第十七章 17.7）
 *
 * 流程：读数据集 → 每个 case 真检索 + 过真实图 → 算指标/judge → 分桶聚合
 *      → 写报告(JSON/CSV) + 落 eval_runs 表 → 阈值门禁（非 0 退出码供 CI 当闸门）
 *
 * 用法：
 *   bun run scripts/run-eval.ts                 # 全量（检索指标 + 真图 + judge）
 *   bun run scripts/run-eval.ts --no-llm        # 只跑检索指标（本地 embedding，便宜、确定）
 *   bun run scripts/run-eval.ts --case=req-login-001
 *
 * 前置：先跑 scripts/seed-eval-corpus.ts 灌入 golden 语料（检索指标依赖它）。
 * 可选：RUN_RAGAS=1 且 RAGAS 服务可达时，对 analyze 报告评 faithfulness。
 */
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmbeddingService } from '../src/document/embedding.service';
import { SearchService, type SearchResult } from '../src/document/search.service';
import { runAnalysisGraph } from '../src/llm/graph/requirement-analysis-graph';
import { judgeReport } from '../eval/judge';
import { loadDataset, EVAL_USER_ID } from '../eval/dataset-loader';
import { precisionAtK, recallAtK, ndcgAtK } from '../rag/evaluation/retrieval-metrics';
import { runRagas as callRagas } from '../rag/evaluation/ragas-runner';
import {
  aggregate,
  gateDecision,
  DEFAULT_GATE,
  type CaseResult,
  type EvalSummary,
} from '../rag/evaluation/aggregate';

config({ path: new URL('../.env', import.meta.url).pathname });

const TOP_K = 5;
const REPORTS_DIR = fileURLToPath(new URL('../eval/reports/', import.meta.url));

function gitSha(): string | undefined {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function formatContext(results: SearchResult[]): string {
  if (results.length === 0) return '无相关参考文档';
  return results
    .map((r, i) => `[文档片段 ${i + 1}]（相关度：${r.score.toFixed(3)}）\n${r.content}`)
    .join('\n\n');
}

function fmt(v: number | undefined): string {
  return v === undefined ? '  -  ' : v.toFixed(2).padStart(5);
}

function printTable(summary: EvalSummary): void {
  const rows = [...summary.buckets, summary.overall];
  console.log('\n┌──────────────────────┬─────┬────────┬───────────┬──────┬───────┬──────────┐');
  console.log('│ 维度                 │  n  │ Recall │ Precision │ NDCG │ Intent│ Judge    │');
  console.log('├──────────────────────┼─────┼────────┼───────────┼──────┼───────┼──────────┤');
  for (const r of rows) {
    const name = (r.bucket === '全量' ? '全量平均' : r.bucket).padEnd(20);
    const judge = r.judgeScore === undefined ? '   -  ' : String(Math.round(r.judgeScore)).padStart(4);
    console.log(
      `│ ${name} │ ${String(r.n).padStart(3)} │ ${fmt(r.recall)}  │  ${fmt(r.precision)}    │ ${fmt(r.ndcg)} │ ${fmt(r.intentCorrect)} │   ${judge}   │`,
    );
  }
  console.log('└──────────────────────┴─────┴────────┴───────────┴──────┴───────┴──────────┘');
}

function writeReport(summary: EvalSummary, results: CaseResult[]): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = `${REPORTS_DIR}${ts}.json`;
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));

  const header = 'bucket,n,recall,precision,ndcg,intentCorrect,judgeScore,faithfulness';
  const csvRows = [...summary.buckets, summary.overall].map((b) =>
    [
      b.bucket,
      b.n,
      b.recall ?? '',
      b.precision ?? '',
      b.ndcg ?? '',
      b.intentCorrect ?? '',
      b.judgeScore ?? '',
      b.faithfulness ?? '',
    ].join(','),
  );
  writeFileSync(`${REPORTS_DIR}${ts}.csv`, [header, ...csvRows].join('\n'));
  return jsonPath;
}

async function main() {
  const args = process.argv.slice(2);
  const noLlm = args.includes('--no-llm');
  const onlyCase = args.find((a) => a.startsWith('--case='))?.split('=')[1];
  const enableRagas = process.env.RUN_RAGAS === '1';

  const cases = loadDataset('requirement-analysis').filter((c) => !onlyCase || c.id === onlyCase);
  if (cases.length === 0) throw new Error(`没有匹配的 case（--case=${onlyCase}）`);

  const prisma = new PrismaService();
  await prisma.$connect();
  const search = new SearchService(prisma, new EmbeddingService());

  const model = noLlm
    ? null
    : new ChatOpenAI({
        model: process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4',
        temperature: 0,
        configuration: { baseURL: process.env.OPENAI_BASE_URL },
        apiKey: process.env.OPENAI_API_KEY,
      });

  console.log(`▶ 评测 ${cases.length} 个 case${noLlm ? '（--no-llm：仅检索指标）' : ''}`);
  const results: CaseResult[] = [];

  for (const c of cases) {
    const r: CaseResult = { id: c.id, tags: c.tags, metrics: {} };

    // 1. 真检索（本地 embedding + pgvector 余弦，确定、便宜）
    const retrieved = await search.similaritySearch(c.input, EVAL_USER_ID, TOP_K);
    const retrievedIds = retrieved.map((x) => x.chunkId);

    // 2. 检索指标（有 ground truth 才算）
    if (c.relevantChunkIds?.length) {
      r.metrics.recall = recallAtK(retrievedIds, c.relevantChunkIds, TOP_K);
      r.metrics.precision = precisionAtK(retrievedIds, c.relevantChunkIds, TOP_K);
      r.metrics.ndcg = ndcgAtK(retrievedIds, c.relevantChunkIds, TOP_K);
    }

    if (model) {
      // 3. 过真实图（喂入真检索拼出的上下文）
      const output = await runAnalysisGraph({
        input: c.input,
        retrievedContext: formatContext(retrieved),
        model,
      });

      // 4. triage 准确率
      r.metrics.intentCorrect = output.intent === c.expectedIntent ? 1 : 0;

      // 5. LLM-as-judge（analyze 类才评报告）
      if (c.expectedIntent === 'analyze' && output.summary) {
        const j = await judgeReport(model, output.summary);
        r.metrics.judgeScore = j.totalScore;
        r.judgePassed = j.passed;

        // 6. faithfulness（仅 RUN_RAGAS=1 且服务可达；不可达 runRagas 返回 null 自动跳过）
        if (enableRagas && retrieved.length > 0) {
          const ragas = await callRagas({
            samples: [
              {
                question: c.input,
                answer: output.summary,
                contexts: retrieved.map((x) => x.content),
                ground_truth: c.groundTruthAnswer,
              },
            ],
            metrics: ['faithfulness'],
          });
          if (ragas?.faithfulness !== undefined) r.metrics.faithfulness = ragas.faithfulness;
        }
      }
    }

    console.log(
      `  ${c.id.padEnd(18)} ${JSON.stringify(r.metrics)}${r.judgePassed === false ? ' ⚠️judge-fail' : ''}`,
    );
    results.push(r);
  }

  // 7. 聚合 + 报告
  const summary = aggregate(results);
  const jsonPath = writeReport(summary, results);
  printTable(summary);

  // 8. 门禁 → 退出码
  const passed = gateDecision(summary, DEFAULT_GATE);

  // 9. 落 eval_runs（持久化每次跑的快照，供历史对比）
  await prisma.eval_runs.create({
    data: {
      gitSha: gitSha(),
      judgeModel: model ? (process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4') : 'none(--no-llm)',
      noLlm,
      totalCases: results.length,
      passed,
      avgRecall: summary.overall.recall ?? null,
      avgPrecision: summary.overall.precision ?? null,
      avgNdcg: summary.overall.ndcg ?? null,
      avgJudgeScore: summary.overall.judgeScore ?? null,
      avgIntentCorrect: summary.overall.intentCorrect ?? null,
      report: { summary, results } as object,
    },
  });
  await prisma.$disconnect();

  console.log(`\n📄 报告已写入 ${jsonPath}`);
  console.log(
    passed
      ? '✅ EVAL PASSED'
      : `❌ EVAL FAILED（recall>=${DEFAULT_GATE.minRecall} / judge>=${DEFAULT_GATE.minJudgeScore} / intent>=${DEFAULT_GATE.minIntentCorrect}）`,
  );
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('run-eval 失败：', err);
  process.exit(1);
});
