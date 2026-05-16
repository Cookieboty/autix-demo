/**
 * document-chunker.ts
 *
 * 第十一章 11.4 — 文档切分流水线（下沉版）
 *
 * 与既有 services/chat/src/document/chunk.service.ts 的关系：
 *   - chunk.service.ts 是绑定 Prisma / SSE / Embedding 的"业务流程"
 *   - 本文件是无副作用的纯切分逻辑，便于 11.4 章节的单元测试与读者本地复用
 *   - 默认 separators 显式覆盖全角中文标点（11.4.5）
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export interface Chunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '，', ' ', ''];

export async function chunkText(
  text: string,
  options: ChunkOptions = {},
): Promise<Chunk[]> {
  const {
    chunkSize = 500,
    chunkOverlap = 50,
    separators = DEFAULT_SEPARATORS,
  } = options;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
  });
  const pieces = await splitter.splitText(text);

  // 通过游标在原文中查找每段位置，便于回溯 startOffset / endOffset
  // overlap 区域允许 startOffset 与上一段 endOffset 重叠，故起点可回退 chunkOverlap
  let cursor = 0;
  return pieces.map((content, index) => {
    const searchFrom = Math.max(0, cursor - chunkOverlap);
    const found = text.indexOf(content, searchFrom);
    const startOffset = found >= 0 ? found : Math.max(0, cursor);
    const endOffset = startOffset + content.length;
    cursor = endOffset;
    return { index, content, startOffset, endOffset };
  });
}
