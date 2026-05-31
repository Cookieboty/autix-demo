/**
 * rubric-loader.ts
 *
 * 第十七章 17.5.1 — 把评分 rubric 从 prompt 里抽出来，外置成可版本化的 yaml。
 * 在线 Critic 与离线 judge 读同一份标准，避免「线上评审标准和离线评测标准打架」。
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';

export interface RubricDimension {
  id: string;
  name: string;
  weight: number;
  desc: string;
}

export interface Rubric {
  version: number;
  dimensions: RubricDimension[];
  gate: {
    minScore: number;
    minPerDimension: number;
  };
}

const RUBRICS_DIR = fileURLToPath(new URL('./rubrics/', import.meta.url));

export function loadRubric(rubricId: string): Rubric {
  const raw = readFileSync(`${RUBRICS_DIR}${rubricId}.yaml`, 'utf-8');
  const rubric = load(raw) as Rubric;

  if (!rubric?.dimensions?.length || !rubric.gate) {
    throw new Error(`rubric ${rubricId} 结构非法：缺少 dimensions 或 gate`);
  }
  const weightSum = rubric.dimensions.reduce((s, d) => s + d.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(`rubric ${rubricId} 权重之和必须为 1，当前为 ${weightSum}`);
  }
  return rubric;
}
