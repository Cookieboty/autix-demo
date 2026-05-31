/**
 * judge.ts —— LLM-as-judge：按版本化 rubric 给需求分析报告打分（第十七章 17.5）。
 *
 * 关键设计：LLM 只负责「给每个维度打分」（它擅长的判断），
 * 加权总分与 gate 判定由确定性代码完成（LLM 不擅长算术，且要可复现）。
 * 与在线 criticNode 共享 rubric 来源（rubrics/*.yaml）。
 */
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { loadRubric, type Rubric } from './rubric-loader';

const dimScoreSchema = z.object({
  dimensionId: z.string(),
  score: z.number().min(0).max(100),
  reason: z.string(),
});
const judgeSchema = z.object({
  dimensions: z.array(dimScoreSchema),
  overallCritique: z.string(),
});

export interface JudgeResult {
  totalScore: number; // 加权总分（0-100，四舍五入）
  dimensions: Record<string, number>; // 各维度分
  passed: boolean; // 是否过 gate
  critique: string;
}

function buildJudgePrompt(rubric: Rubric): string {
  const dims = rubric.dimensions
    .map((d) => `- ${d.id}（${d.name}，权重 ${d.weight}）：${d.desc}`)
    .join('\n');
  return `你是资深需求评审专家，对一份"需求分析报告"按以下维度逐项打分（0-100）。

评分维度：
${dims}

要求：
- 只输出每个维度的分数和简短理由，不要自己计算加权总分（总分由系统计算）。
- 报告"又长又水"不应得高分：长度不是质量，空泛套话要扣可执行性分。
- dimensionId 必须严格用上面括号外的英文 id（${rubric.dimensions.map((d) => d.id).join(' / ')}）。`;
}

export async function judgeReport(
  model: BaseChatModel,
  report: string,
  rubricId = 'requirement-analysis',
): Promise<JudgeResult> {
  const rubric = loadRubric(rubricId);
  const structured = model.withStructuredOutput(judgeSchema);
  const result = await structured.invoke([
    { role: 'system', content: buildJudgePrompt(rubric) },
    { role: 'user', content: `待评分报告：\n\n${report}` },
  ]);

  // 加权汇总在代码里算（权重来自 rubric），不让 LLM 算
  const dims: Record<string, number> = {};
  let total = 0;
  for (const d of rubric.dimensions) {
    const got = result.dimensions.find((x) => x.dimensionId === d.id)?.score ?? 0;
    dims[d.id] = got;
    total += got * d.weight;
  }
  const passed =
    total >= rubric.gate.minScore &&
    rubric.dimensions.every((d) => dims[d.id] >= rubric.gate.minPerDimension);

  return {
    totalScore: Math.round(total),
    dimensions: dims,
    passed,
    critique: result.overallCritique,
  };
}
