/**
 * aggregate.ts
 *
 * 第十七章 17.7 — 把逐 case 的评测结果按 tag 分桶聚合，并做阈值门禁判定。
 *
 * 设计取舍：
 *   - 纯函数、零依赖、确定：可在 Layer 1 单测里直接断言
 *   - 每个指标各自只在「有该指标的 case」上取平均（缺失维度不拉低均值），
 *     例如 chat/query 类 case 没有检索指标，不应把 recall 拉成 0
 *   - 门禁阈值显式传入（带默认），不写死在代码深处
 */

/** 单维度指标名 —— 与 run-eval / judge / 检索指标一一对应 */
export interface CaseMetrics {
  intentCorrect?: number; // triage 是否命中（0/1）
  recall?: number; // Recall@K
  precision?: number; // Precision@K
  ndcg?: number; // NDCG@K
  judgeScore?: number; // LLM-as-judge 加权总分（0-100）
  faithfulness?: number; // RAGAS 忠实度（0-1，服务可达才有）
}

export interface CaseResult {
  id: string;
  tags: string[];
  metrics: CaseMetrics;
  judgePassed?: boolean;
}

export interface BucketStats {
  /** 桶名：tag 名，或 '全量' */
  bucket: string;
  n: number;
  recall?: number;
  precision?: number;
  ndcg?: number;
  judgeScore?: number;
  intentCorrect?: number;
  faithfulness?: number;
}

export interface EvalSummary {
  overall: BucketStats;
  buckets: BucketStats[];
}

const METRIC_KEYS: (keyof CaseMetrics)[] = [
  'recall',
  'precision',
  'ndcg',
  'judgeScore',
  'intentCorrect',
  'faithfulness',
];

/** 在「定义了该指标的 case」上取平均；一个都没有则返回 undefined */
function avgDefined(results: CaseResult[], key: keyof CaseMetrics): number | undefined {
  const vals = results
    .map((r) => r.metrics[key])
    .filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function statsFor(bucket: string, results: CaseResult[]): BucketStats {
  const s: BucketStats = { bucket, n: results.length };
  for (const k of METRIC_KEYS) {
    const v = avgDefined(results, k);
    if (v !== undefined) (s as Record<string, number>)[k] = v;
  }
  return s;
}

export function aggregate(results: CaseResult[]): EvalSummary {
  const tagSet = new Set<string>();
  for (const r of results) for (const t of r.tags) tagSet.add(t);

  const buckets = [...tagSet].sort().map((tag) =>
    statsFor(
      tag,
      results.filter((r) => r.tags.includes(tag)),
    ),
  );

  return { overall: statsFor('全量', results), buckets };
}

export interface GateThresholds {
  minRecall: number;
  minJudgeScore: number;
  minIntentCorrect: number;
}

export const DEFAULT_GATE: GateThresholds = {
  minRecall: 0.8,
  minJudgeScore: 75,
  minIntentCorrect: 0.9,
};

/**
 * 门禁判定：全量均值需同时过三道阈值。
 * 缺失的维度（如本次没跑 judge）视为「该维度不卡」，不阻塞——
 * 评估是分层触发的（17.7：--no-llm 时只有检索指标），不能因维度缺席就误判 fail。
 */
export function gateDecision(
  summary: EvalSummary,
  thresholds: GateThresholds = DEFAULT_GATE,
): boolean {
  const o = summary.overall;
  if (o.recall !== undefined && o.recall < thresholds.minRecall) return false;
  if (o.judgeScore !== undefined && o.judgeScore < thresholds.minJudgeScore) return false;
  if (o.intentCorrect !== undefined && o.intentCorrect < thresholds.minIntentCorrect) {
    return false;
  }
  return true;
}
