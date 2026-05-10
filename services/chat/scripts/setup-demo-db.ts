/**
 * setup-demo-db.ts
 *
 * 第十章 Demo 数据库初始化脚本。
 * 
 * 用法：
 *   1. 复制 .env.demo 为 .env（或手动修改 DATABASE_URL 指向 autix_chat_demo）
 *   2. 创建 PostgreSQL 数据库：createdb autix_chat_demo
 *   3. 运行迁移：cd services/chat && bunx prisma migrate deploy
 *   4. 运行本脚本填充最小 demo 数据：bun scripts/setup-demo-db.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🔧 第十章 Demo 数据库初始化...');
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`);

  // 验证连接
  await prisma.$connect();
  console.log('✅ 数据库连接成功');

  // Seed: 默认模型配置
  const defaultModels = [
    { name: 'GPT-4o (强模型)', model: 'gpt-4o', provider: 'openai', type: 'general' as const, priority: 10, isDefault: true },
    { name: 'GPT-4o-mini (中等模型)', model: 'gpt-4o-mini', provider: 'openai', type: 'general' as const, priority: 5 },
    { name: 'DeepSeek V3 (经济模型)', model: 'deepseek-chat', provider: 'deepseek', type: 'general' as const, priority: 1 },
  ];

  for (const cfg of defaultModels) {
    await prisma.model_configs.upsert({
      where: { id: `demo-${cfg.model}` },
      update: {},
      create: {
        id: `demo-${cfg.model}`,
        name: cfg.name,
        model: cfg.model,
        provider: cfg.provider,
        type: cfg.type,
        priority: cfg.priority,
        isDefault: cfg.isDefault ?? false,
        isActive: true,
        visibility: 'public',
      },
    });
    console.log(`  ✅ model_config: ${cfg.name}`);
  }

  // Seed: Agent 角色默认模型映射
  const agentDefaults = [
    { agentName: 'supervisor', modelConfigId: 'demo-gpt-4o', tier: 'strong', description: '调度决策，需要强模型' },
    { agentName: 'functional_expert', modelConfigId: 'demo-gpt-4o-mini', tier: 'medium', description: '功能分析，中等模型即可' },
    { agentName: 'performance_expert', modelConfigId: 'demo-gpt-4o-mini', tier: 'medium', description: '性能分析' },
    { agentName: 'security_expert', modelConfigId: 'demo-gpt-4o', tier: 'strong', description: '安全分析，误判成本高' },
    { agentName: 'compliance_expert', modelConfigId: 'demo-gpt-4o', tier: 'strong', description: '合规分析，误判成本高' },
    { agentName: 'risk_agent', modelConfigId: 'demo-gpt-4o-mini', tier: 'medium', description: '风险评估' },
    { agentName: 'summary_agent', modelConfigId: 'demo-gpt-4o', tier: 'strong', description: '最终报告，质量要求高' },
    { agentName: 'critic', modelConfigId: 'demo-gpt-4o', tier: 'strong', description: '评审节点' },
    { agentName: 'compressor', modelConfigId: 'demo-deepseek-chat', tier: 'weak', description: '摘要压缩，用小模型即可' },
  ];

  for (const ad of agentDefaults) {
    await prisma.agent_model_defaults.upsert({
      where: { agentName: ad.agentName },
      update: { modelConfigId: ad.modelConfigId, tier: ad.tier, description: ad.description },
      create: ad,
    });
    console.log(`  ✅ agent_model_default: ${ad.agentName} → ${ad.tier}`);
  }

  console.log('\n🎉 Demo 数据库初始化完成！');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败：', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
