/**
 * parent-child-chunker.ts
 *
 * 第十一章 11.4.7 — Parent-Child 切分（小块检索 + 大块生成）
 *
 *   - 检索阶段使用 children（粒度小、向量聚焦）
 *   - 生成阶段回查 parent（上下文完整）
 *   - 每个 child 必带 parentIndex，方便从向量命中回溯到大块原文
 */

import { chunkText, type Chunk, type ChunkOptions } from './document-chunker';

export interface ChildChunk extends Chunk {
  parentIndex: number;
}

export interface ParentChildChunks {
  parents: Chunk[];
  children: ChildChunk[];
}

export interface ParentChildOptions {
  parentSize?: number;
  childSize?: number;
  parentOverlap?: number;
  childOverlap?: number;
  separators?: ChunkOptions['separators'];
}

export async function chunkParentChild(
  text: string,
  options: ParentChildOptions = {},
): Promise<ParentChildChunks> {
  const {
    parentSize = 1500,
    childSize = 200,
    parentOverlap = 100,
    childOverlap = 30,
    separators,
  } = options;

  const parents = await chunkText(text, {
    chunkSize: parentSize,
    chunkOverlap: parentOverlap,
    separators,
  });

  const children: ChildChunk[] = [];
  for (const parent of parents) {
    const subChunks = await chunkText(parent.content, {
      chunkSize: childSize,
      chunkOverlap: childOverlap,
      separators,
    });
    for (const sub of subChunks) {
      children.push({
        ...sub,
        // 子块的 offset 是相对 parent.content 的本地偏移，加上 parent 在原文中的起点
        startOffset: parent.startOffset + sub.startOffset,
        endOffset: parent.startOffset + sub.endOffset,
        parentIndex: parent.index,
      });
    }
  }

  return { parents, children };
}
