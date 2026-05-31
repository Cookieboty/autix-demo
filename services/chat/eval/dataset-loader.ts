/**
 * dataset-loader.ts
 *
 * 第十七章 17.6 — 读取 golden 数据集（.jsonl，每行一个 case）。
 * 字段遵守 A3 白名单：只放评测真正需要的。
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/** 评测专用 userId：seed 灌库与检索评测共用，与真实用户数据隔离 */
export const EVAL_USER_ID = 'eval-bot';

export type ExpectedIntent = 'analyze' | 'query' | 'chat';

export interface EvalCase {
  id: string;
  input: string;
  expectedIntent: ExpectedIntent;
  /** 该 query 的相关文档（ground truth），评检索指标用；非 RAG case 可缺省 */
  relevantChunkIds?: string[];
  /** 标准答案，评 faithfulness 时作参照；可缺省 */
  groundTruthAnswer?: string;
  /** 分桶标签（typical/edge/compliance...） */
  tags: string[];
}

const DATASETS_DIR = fileURLToPath(new URL('./datasets/', import.meta.url));

export function loadDataset(name: string): EvalCase[] {
  const raw = readFileSync(`${DATASETS_DIR}${name}.jsonl`, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      const obj = JSON.parse(line) as EvalCase;
      if (!obj.id || !obj.input || !obj.expectedIntent) {
        throw new Error(`数据集 ${name} 第 ${i + 1} 行缺少必填字段 id/input/expectedIntent`);
      }
      return { ...obj, tags: obj.tags ?? [] };
    });
}

/** 读取语料（seed 脚本与检索评测共用，chunkId 稳定可对齐数据集 relevantChunkIds） */
export interface CorpusChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
}

export function loadCorpus(name = 'requirement-kb'): CorpusChunk[] {
  const dir = fileURLToPath(new URL('./corpus/', import.meta.url));
  const raw = readFileSync(`${dir}${name}.jsonl`, 'utf-8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as CorpusChunk);
}
