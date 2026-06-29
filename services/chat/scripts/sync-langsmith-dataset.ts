/**
 * sync-langsmith-dataset.ts
 *
 * 把本地 golden 数据集（eval/datasets/*.jsonl）幂等上传到 LangSmith Dataset。
 *
 * 前置：
 *   1. 注册 https://smith.langchain.com 并获取 API key
 *   2. 在 .env 里配置 LANGSMITH_API_KEY=lsv2_...
 *
 * 运行：cd services/chat && bun run scripts/sync-langsmith-dataset.ts
 */
import { Client } from 'langsmith';
import { config } from 'dotenv';
import { loadDataset } from '../eval/dataset-loader';

config({ path: new URL('../.env', import.meta.url).pathname });

const DATASET_NAME = 'autix-requirement-analysis';

async function main() {
  if (!process.env.LANGSMITH_API_KEY) {
    console.error('❌ 缺少 LANGSMITH_API_KEY，请先在 .env 中配置');
    console.error('   注册地址：https://smith.langchain.com');
    process.exit(1);
  }

  const client = new Client();
  const cases = loadDataset('requirement-analysis');

  // 幂等：已存在则复用，不存在则创建
  let dataset;
  try {
    dataset = await client.readDataset({ datasetName: DATASET_NAME });
    console.log(`📦 Dataset "${DATASET_NAME}" 已存在 (id=${dataset.id})，将追加/更新`);
  } catch {
    dataset = await client.createDataset(DATASET_NAME, {
      description: '需求分析 golden 数据集（第十七章 17.6）',
    });
    console.log(`📦 Dataset "${DATASET_NAME}" 已创建 (id=${dataset.id})`);
  }

  // 上传所有 case
  await client.createExamples({
    inputs: cases.map((c) => ({ input: c.input })),
    outputs: cases.map((c) => ({
      expectedIntent: c.expectedIntent,
      relevantChunkIds: c.relevantChunkIds ?? [],
      groundTruthAnswer: c.groundTruthAnswer ?? null,
    })),
    metadata: cases.map((c) => ({ id: c.id, tags: c.tags })),
    datasetId: dataset.id,
  });

  console.log(`✅ 已上传 ${cases.length} 条 case 到 LangSmith Dataset: ${DATASET_NAME}`);
  console.log(`   查看地址：https://smith.langchain.com → Datasets → ${DATASET_NAME}`);
}

main().catch((err) => {
  console.error('sync 失败：', err.message ?? err);
  process.exit(1);
});
