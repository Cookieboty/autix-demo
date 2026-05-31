/**
 * seed-eval-corpus.ts —— 给检索评测灌入 golden 语料（第十七章 17.3 / option B）
 *
 * 为什么需要：document_chunks.id 默认是自动 cuid，无法天然等于数据集里的
 * relevantChunkIds（c-auth-1…）。这里 seed 时**显式指定稳定 chunk id**，
 * 让数据集的 ground-truth 与库中真实 id 对齐——检索走真 embedding + 真 pgvector
 * 余弦，指标是真实的，只是 id 用了可读的稳定值。
 *
 * 幂等：每次先清掉 EVAL_USER_ID 名下旧文档（级联删 chunk），再重新灌。
 *
 * 运行：cd services/chat && bun run scripts/seed-eval-corpus.ts
 */
import { Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmbeddingService } from '../src/document/embedding.service';
import { loadCorpus, EVAL_USER_ID } from '../eval/dataset-loader';

config({ path: new URL('../.env', import.meta.url).pathname });

async function main() {
  const prisma = new PrismaService();
  const embedding = new EmbeddingService();
  await prisma.$connect();

  const chunks = loadCorpus('requirement-kb');
  console.log(`📚 语料 ${chunks.length} 个 chunk，开始灌库（userId=${EVAL_USER_ID}）`);

  // 1) 幂等清理：删旧文档（chunk 级联删）
  const del = await prisma.documents.deleteMany({ where: { userId: EVAL_USER_ID } });
  console.log(`🧹 清理旧文档 ${del.count} 篇`);

  // 2) 按 documentId 分组建 documents
  const byDoc = new Map<string, typeof chunks>();
  for (const c of chunks) {
    if (!byDoc.has(c.documentId)) byDoc.set(c.documentId, []);
    byDoc.get(c.documentId)!.push(c);
  }
  for (const [docId, docChunks] of byDoc) {
    await prisma.documents.create({
      data: {
        id: docId,
        userId: EVAL_USER_ID,
        filename: docChunks[0].documentName,
        mimeType: 'text/markdown',
        size: docChunks.reduce((s, c) => s + c.content.length, 0),
        status: 'ready',
        chunkCount: docChunks.length,
      },
    });
  }

  // 3) 逐 chunk 真 embedding + 显式 id 插入（vector 字面量内联，其余参数化）
  let i = 0;
  for (const c of chunks) {
    const [vector] = await embedding.embedTexts([c.content]);
    if (!vector?.length) throw new Error(`embedding 失败：${c.chunkId}`);
    const vecRaw = Prisma.raw(`'[${vector.join(',')}]'::vector`);
    await prisma.$executeRaw`
      INSERT INTO document_chunks (id, "documentId", content, "chunkIndex", embedding)
      VALUES (${c.chunkId}, ${c.documentId}, ${c.content}, ${i}, ${vecRaw})
    `;
    i += 1;
  }

  console.log(`✅ 灌库完成：${byDoc.size} 篇文档 / ${chunks.length} 个 chunk（含 384 维向量）`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('seed 失败：', err);
  process.exit(1);
});
