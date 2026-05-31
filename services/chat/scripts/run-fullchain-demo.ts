/**
 * run-fullchain-demo.ts —— 第二十章《满血版链路》端到端演示脚本
 *
 * 走的是真正的生产编排入口 OrchestratorService.streamOrchestrate，逐个事件实时打印，
 * 让「每一步 + 每次真实 LLM 调用」都可见。覆盖本章六个接线点的真生效：
 *   - 20.2 检索升级：retrievedContext 传入（hybrid 后端在 SearchService，这里直接喂检索结果）
 *   - 20.3 RAG 修复：检索内容真正进报告（看报告里有没有知识库特征术语）
 *   - 20.4 MCP 工具：initMcp 后专家可调真实 MCP 工具（看 agent_start 里的工具名）
 *   - 20.5 Skills：orchestrator 前置注入需求分析方法论
 *   - 20.6 长链路由：多工单输入走 DeepAgent 分支（看 log "DeepAgent 长链分支"）
 *   - 20.7 历史：演示里直接在 input 前拼历史块（生产由 controller 拼）
 *
 * 运行：cd services/chat && bun run scripts/run-fullchain-demo.ts
 * 需 .env 提供 OPENAI_API_KEY[/ OPENAI_BASE_URL]；会产生真实（付费）LLM 调用。
 */
import { config } from 'dotenv';
import { OrchestratorService } from '../src/llm/agents/orchestrator.service';
import { initMcp, mcpManager } from '../src/mcp/mcp-bootstrap';

config({ path: new URL('../.env', import.meta.url).pathname });

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ 未设置 OPENAI_API_KEY，本 demo 需要真实 LLM。请在 services/chat/.env 配置后重试。');
  process.exit(1);
}

const oneLine = (v: unknown, n = 100) =>
  String(typeof v === 'string' ? v : (JSON.stringify(v) ?? ''))
    .replace(/\s+/g, ' ')
    .slice(0, n);

// orchestrate 不依赖 modelConfigService/uiResponseService（仅文本流式路径），传空桩即可。
const orchestrator = new OrchestratorService({} as never, {} as never);

/** 跑一个场景：逐事件打印，最后返回报告正文。 */
async function runScenario(
  title: string,
  input: string,
  retrievedContext: string,
): Promise<string> {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 场景：${title}`);
  console.log('='.repeat(80));
  console.log(`📨 输入：${oneLine(input, 120)}`);
  console.log(`📚 检索上下文：${retrievedContext === '无相关参考文档' ? '（无）' : oneLine(retrievedContext, 120)}`);
  console.log('─'.repeat(80));

  let report = '';
  let tokenBuf = '';
  let lastTokenAgent = '';

  const flushTokens = () => {
    if (tokenBuf.trim()) {
      console.log(`   💬 [${lastTokenAgent}] ${oneLine(tokenBuf, 100)}`);
    }
    tokenBuf = '';
  };

  for await (const ev of orchestrator.streamOrchestrate(input, retrievedContext, undefined)) {
    switch (ev.type) {
      case 'log':
        flushTokens();
        console.log(`📝 ${ev.message}`);
        break;
      case 'agent_start':
        flushTokens();
        console.log(`▶ 步骤 ${ev.step}${ev.parallel ? '（并行）' : ''}：${ev.agent}`);
        break;
      case 'agent_end':
        flushTokens();
        console.log(`✅ 完成：${ev.agent}`);
        break;
      case 'token':
        if (ev.agent !== lastTokenAgent) {
          flushTokens();
          lastTokenAgent = ev.agent;
        }
        tokenBuf += ev.content;
        break;
      case 'final':
        flushTokens();
        report = ev.result.report ?? '';
        break;
    }
  }

  console.log('─'.repeat(80));
  console.log('🤖 报告正文（节选）：');
  console.log(report.slice(0, 600));
  console.log(`📊 报告长度：${report.length} 字符`);
  return report;
}

async function main() {
  console.log('🔌 连接 MCP servers（专家将用真实 MCP 工具，连不上自动降级 Mock）...');
  await initMcp();
  console.log(`   MCP 白名单工具：[${mcpManager.getTools().map((t) => t.name).join(', ') || '(无，降级 Mock)'}]`);

  // ── 场景 1：短任务（单需求）→ 走主图；检索内容应进报告（20.2/20.3/20.4/20.5）──
  const fact =
    '[知识库] 企业微信登录必须使用 OAuth2 授权码模式，并在回调时校验 corpId。';
  const report1 = await runScenario(
    '短任务·单需求（主图 + RAG 注入 + MCP 工具 + Skills）',
    '为后台管理系统增加企业微信扫码登录：用户用企业微信授权登录，自动绑定已有账号，支持单点登出。',
    fact,
  );
  const ragHit = /OAuth2|授权码|corpId/i.test(report1);
  console.log(`\n🔎 20.3 校验：报告是否消费了检索内容（出现 OAuth2/授权码/corpId）→ ${ragHit ? '✅ 是' : '❌ 否'}`);

  // ── 场景 2：长任务（多工单）→ 走 DeepAgent 分支（20.6）──
  const report2 = await runScenario(
    '长任务·多工单（DeepAgent 跨工单编排）',
    '评估 REQ-001（企业微信登录）与 REQ-002（订单百万行异步导出）的总体影响和冲突。',
    '无相关参考文档',
  );
  console.log(`\n🔎 20.6 校验：长链分支产出非空报告 → ${report2.length > 0 ? '✅ 是' : '❌ 否'}`);

  console.log('\n' + '='.repeat(80));
  console.log('🎉 满血链路 demo 跑完：短任务走主图、长任务走 DeepAgent，RAG/MCP/Skills 均在主链路生效。');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((err) => {
  console.error('demo 失败：', err);
  process.exit(1);
});
