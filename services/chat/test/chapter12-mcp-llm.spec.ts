/**
 * chapter12-mcp-llm.spec.ts
 *
 * 第十二章《MCP——工具调用的操作系统》Layer 2：LLM 集成测试
 *
 * 验证 LLM 能否正确选择和调用 MCP 工具完成业务任务。
 *
 * 运行方式：
 *   bun test test/chapter12-mcp-llm.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const SKIP = !OPENAI_API_KEY;

if (SKIP) {
  console.warn('⚠️  OPENAI_API_KEY 未设置，LLM 集成测试将跳过');
}

// ============================================================================
// Helper：创建 MCP-backed LangChain 工具集
// ============================================================================

async function createMCPTools() {
  const { client, server, cleanup } = await createFullMCPServer();
  const { tools: mcpTools } = await client.listTools();

  const langchainTools = mcpTools.map((tool) => {
    const inputSchema = tool.inputSchema as any;
    const required = new Set(inputSchema.required || []);
    const schemaProps: Record<string, any> = {};

    for (const [key, prop] of Object.entries(inputSchema.properties || {} as Record<string, any>)) {
      const p = prop as any;
      let zodType: any;
      switch (p.type) {
        case 'string': zodType = z.string(); break;
        case 'number': zodType = z.number(); break;
        case 'array': zodType = z.array(z.any()); break;
        default: zodType = z.any();
      }
      if (!required.has(key)) zodType = zodType.optional();
      if (p.description) zodType = zodType.describe(p.description);
      schemaProps[key] = zodType;
    }

    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description || tool.name,
      schema: z.object(schemaProps),
      func: async (args: any) => {
        const result = await client.callTool({ name: tool.name, arguments: args });
        const content = result.content as Array<{ type: string; text?: string }>;
        return content.map((c) => c.text || '').join('\n');
      },
    });
  });

  return { tools: langchainTools, cleanup };
}

// ============================================================================
// 12.5 Agent 自主选择 MCP 工具
// ============================================================================

describe('12.5 LLM 集成 - Agent 自主选择 MCP 工具', () => {
  if (SKIP) {
    it.skip('需要 OPENAI_API_KEY 环境变量', () => {});
    return;
  }

  let tools: DynamicStructuredTool[];
  let cleanup: () => Promise<void>;
  let llm: ChatOpenAI;

  beforeAll(async () => {
    const result = await createMCPTools();
    tools = result.tools;
    cleanup = result.cleanup;
    llm = new ChatOpenAI({
      model: 'gpt-5.4',
      temperature: 0,
      configuration: { baseURL: OPENAI_BASE_URL },
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('收到"分析这个需求的完整性" → 模型选择 analyze_completeness', async () => {
    const agent = createReactAgent({ llm, tools });
    const result = await agent.invoke({
      messages: [new HumanMessage('请分析这个需求的完整性：作为管理员，我需要能够批量导入用户数据，支持 CSV 格式')],
    });

    const messages = result.messages;
    const toolCalls = messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));

    console.log('  Agent 调用的工具:', toolCalls.join(', '));
    console.log('  最终回答:', messages[messages.length - 1].content?.toString().substring(0, 100) + '...');
    expect(toolCalls).toContain('analyze_completeness');
  }, 60000);
});

// ============================================================================
// 12.7 Agent 自主调用搜索工具
// ============================================================================

describe('12.7 LLM 集成 - Agent 使用搜索工具', () => {
  if (SKIP) {
    it.skip('需要 OPENAI_API_KEY 环境变量', () => {});
    return;
  }

  let tools: DynamicStructuredTool[];
  let cleanup: () => Promise<void>;
  let llm: ChatOpenAI;

  beforeAll(async () => {
    const result = await createMCPTools();
    tools = result.tools;
    cleanup = result.cleanup;
    llm = new ChatOpenAI({
      model: 'gpt-5.4',
      temperature: 0,
      configuration: { baseURL: OPENAI_BASE_URL },
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('收到"搜索竞品的批量导入功能" → 模型选择 search_competitors', async () => {
    const agent = createReactAgent({ llm, tools });
    const result = await agent.invoke({
      messages: [new HumanMessage('帮我搜索一下竞品的批量导入功能是怎么做的')],
    });

    const messages = result.messages;
    const toolCalls = messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));

    console.log('  Agent 调用的工具:', toolCalls.join(', '));
    expect(toolCalls).toContain('search_competitors');
  }, 60000);
});

// ============================================================================
// 12.13 完整场景 - 三工具协同
// ============================================================================

describe('12.13 LLM 集成 - 三工具协同完整场景', () => {
  if (SKIP) {
    it.skip('需要 OPENAI_API_KEY 环境变量', () => {});
    return;
  }

  let tools: DynamicStructuredTool[];
  let cleanup: () => Promise<void>;
  let llm: ChatOpenAI;

  beforeAll(async () => {
    const result = await createMCPTools();
    tools = result.tools;
    cleanup = result.cleanup;
    llm = new ChatOpenAI({
      model: 'gpt-5.4',
      temperature: 0,
      configuration: { baseURL: OPENAI_BASE_URL },
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('完整需求分析：analyze + search + estimate', async () => {
    const agent = createReactAgent({ llm, tools });
    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          `请对以下需求做完整分析：
"作为运营人员，我需要批量导入用户数据，支持 CSV 和 Excel 格式，要求单次导入支持1万条记录"

请你依次完成：
1. 用 analyze_completeness 分析需求完整性
2. 用 search_competitors 搜索竞品是怎么做批量导入的
3. 用 estimate_complexity 估算这个需求的技术复杂度

最后给出综合分析报告。`
        ),
      ],
    });

    const messages = result.messages;
    const toolCalls = messages
      .filter((m: any) => m.tool_calls?.length > 0)
      .flatMap((m: any) => m.tool_calls.map((tc: any) => tc.name));

    console.log('  Agent 调用链:', toolCalls.join(' → '));
    console.log('  最终报告:', messages[messages.length - 1].content?.toString().substring(0, 200) + '...');

    expect(toolCalls).toContain('analyze_completeness');
    expect(toolCalls).toContain('search_competitors');
    expect(toolCalls).toContain('estimate_complexity');
  }, 120000);
});

// ============================================================================
// Helper：创建完整 MCP Server（McpServer 高级 API）
// ============================================================================

async function createFullMCPServer() {
  const server = new McpServer(
    { name: 'full-test-server', version: '1.0.0' },
  );

  // Tool 1: 需求完整性分析
  server.tool(
    'analyze_completeness',
    '分析需求描述的完整性，检查是否缺少关键维度。当用户要求"分析需求"、"检查完整性"时使用。',
    { requirementText: z.string().describe('需求描述文本') },
    async ({ requirementText }) => {
      const dims = [
        { name: '用户角色', kw: ['用户', '角色', '作为', '管理员', '运营'] },
        { name: '功能描述', kw: ['能够', '可以', '支持', '实现', '需要'] },
        { name: '验收标准', kw: ['验收', '标准', '应该', '必须'] },
        { name: '优先级', kw: ['优先', 'P0', 'P1', 'P2'] },
        { name: '非功能需求', kw: ['性能', '安全', '并发', '响应时间'] },
        { name: '边界条件', kw: ['边界', '异常', '限制', '最大', '最小'] },
      ];
      const covered = dims.filter((d) => d.kw.some((k) => requirementText.includes(k))).map((d) => d.name);
      const missing = dims.filter((d) => !d.kw.some((k) => requirementText.includes(k))).map((d) => d.name);
      const score = Math.round((covered.length / dims.length) * 100);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ completenessScore: score, coveredDimensions: covered, missingDimensions: missing, suggestion: missing.length > 0 ? `建议补充：${missing.join('、')}` : '需求完整' }, null, 2),
        }],
      };
    },
  );

  // Tool 2: 复杂度估算
  server.tool(
    'estimate_complexity',
    '估算需求的技术复杂度，返回 T-shirt size（S/M/L/XL）。当用户要求"估算复杂度"、"多久能完成"时使用。',
    { requirementText: z.string().describe('需求描述') },
    async ({ requirementText }) => {
      let score = 0;
      const factors: string[] = [];
      if (/集成|第三方|API/.test(requirementText)) { score += 3; factors.push('外部集成'); }
      if (/批量|导入|导出|迁移/.test(requirementText)) { score += 2; factors.push('数据处理'); }
      if (/实时|推送|WebSocket/.test(requirementText)) { score += 2; factors.push('实时通信'); }
      if (/AI|智能|模型/.test(requirementText)) { score += 3; factors.push('AI/ML'); }
      const size = score <= 2 ? 'S' : score <= 4 ? 'M' : score <= 6 ? 'L' : 'XL';
      const days = { S: '1-3天', M: '3-7天', L: '1-3周', XL: '3周以上' }[size];
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ size, estimatedDays: days, complexityScore: score, factors }, null, 2),
        }],
      };
    },
  );

  // Tool 3: 搜索竞品
  server.tool(
    'search_competitors',
    '搜索竞品的相关功能实现。当用户要求"搜索竞品"、"看看别人怎么做"、"竞品调研"时使用。',
    {
      query: z.string().describe('搜索关键词'),
      domain: z.string().optional().describe('限定搜索域名'),
    },
    async ({ query }) => {
      const q = query.toLowerCase();
      let results;
      if (q.includes('批量') || q.includes('导入')) {
        results = [
          { title: 'Jira 批量导入', snippet: 'CSV 格式，限制 1000 条/次，支持字段映射', url: 'https://atlassian.com/docs' },
          { title: 'Linear 导入', snippet: 'API + CSV 双通道，支持增量同步', url: 'https://linear.app/docs' },
          { title: '飞书多维表格导入', snippet: '支持 Excel/CSV，单次 5 万行，异步处理', url: 'https://feishu.cn/docs' },
        ];
      } else {
        results = [{ title: `${query} 竞品参考`, snippet: '综合参考资料', url: 'https://example.com' }];
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ query, mode: 'mock', results, summary: `找到 ${results.length} 个竞品参考` }, null, 2),
        }],
      };
    },
  );

  // Tool 4: 搜索最佳实践
  server.tool(
    'search_best_practices',
    '搜索行业最佳实践。当用户要求"搜索最佳实践"、"业界标准做法"时使用。',
    {
      topic: z.string().describe('搜索主题'),
      industry: z.string().optional().describe('行业'),
    },
    async ({ topic }) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ topic, results: [{ title: `${topic} 最佳实践`, snippet: '行业标准做法参考' }] }, null, 2),
        }],
      };
    },
  );

  // Tool 5: 搜索技术选型
  server.tool(
    'search_tech_stack',
    '搜索技术选型参考。当用户要求"技术选型"、"方案对比"时使用。',
    {
      technology: z.string().describe('技术关键词'),
      useCase: z.string().optional().describe('使用场景'),
    },
    async ({ technology }) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ technology, results: [{ title: `${technology} 技术对比`, snippet: '技术方案对比分析' }] }, null, 2),
        }],
      };
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'llm-test-client', version: '1.0.0' }, { capabilities: {} });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}
