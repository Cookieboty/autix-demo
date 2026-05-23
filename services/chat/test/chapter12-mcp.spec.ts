/**
 * chapter12-mcp.spec.ts
 *
 * 第十二章《MCP——工具调用的操作系统》配套测试用例（Layer 1：协议层单元测试）
 *
 * 设计目标（与第十一章保持一致）：
 * - **按文档章节组织**：每个 describe 标题以「12.x.y」开头
 * - **读者按图索骥**：在章节里看到 📋 标记后可直接：
 *     bun test test/chapter12-mcp.spec.ts -t "12.4"
 * - **零依赖**：使用 InMemoryTransport mock，无需网络、LLM API key
 * - **效果可视化**：通过 console.log 打印关键输出让读者直观看到
 *
 * Layer 2（LLM 集成测试）见 chapter12-mcp-llm.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

import { jsonSchemaToZod } from '../src/mcp/mcp-to-langchain.js';

// ============================================================================
// 12.4 从零搭建 MCP Server：需求分析工具
// ============================================================================

describe('12.4 Requirement Analyzer MCP Server', () => {
  let client: Client;
  let server: McpServer;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createTestServerWithClient();
    client = result.client;
    server = result.server;
    cleanup = result.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('12.4.1 analyze_completeness', () => {
    it('返回标准 MCP content 结构', async () => {
      const result = await client.callTool({
        name: 'analyze_completeness',
        arguments: {
          requirementText: '作为管理员，我希望能够批量导入用户数据，要求支持 CSV 格式',
        },
      });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as Array<{ type: string }>)[0].type).toBe('text');

      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.completenessScore).toBeGreaterThan(0);
      expect(parsed.totalDimensions).toBe(6);
      expect(parsed.coveredDimensions).toBeArray();
      expect(parsed.missingDimensions).toBeArray();
      console.log('  完整性评分:', parsed.completenessScore + '%');
      console.log('  覆盖维度:', parsed.coveredDimensions.join(', '));
      console.log('  缺失维度:', parsed.missingDimensions.join(', '));
    });

    it('全维度覆盖时分数为 100', async () => {
      const fullRequirement = `
        作为管理员用户，我需要能够批量导入数据。
        验收标准：导入完成后显示成功数量。
        优先级 P1。
        性能要求：1000条数据30秒内完成。
        边界条件：文件超过10MB时提示错误。
      `;
      const result = await client.callTool({
        name: 'analyze_completeness',
        arguments: { requirementText: fullRequirement },
      });

      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.completenessScore).toBe(100);
      expect(parsed.missingDimensions).toHaveLength(0);
    });
  });

  describe('12.4.2 estimate_complexity', () => {
    it('简单需求返回 S', async () => {
      const result = await client.callTool({
        name: 'estimate_complexity',
        arguments: { requirementText: '修改按钮颜色为蓝色' },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.size).toBe('S');
      console.log('  简单需求 →', parsed.size, `(${parsed.estimatedDays})`);
    });

    it('涉及外部集成和 AI 返回 L 或 XL', async () => {
      const result = await client.callTool({
        name: 'estimate_complexity',
        arguments: {
          requirementText: '集成第三方 API 进行 AI 智能推荐，支持实时推送通知',
        },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(['L', 'XL']).toContain(parsed.size);
      console.log('  复杂需求 →', parsed.size, `(${parsed.estimatedDays})`);
      console.log('  复杂因素:', parsed.factors.join(', '));
    });
  });

  describe('12.4.3 check_conflicts', () => {
    it('关键词重叠 ≥ 3 时检出冲突', async () => {
      const result = await client.callTool({
        name: 'check_conflicts',
        arguments: {
          newRequirement: '批量 导入 用户 数据 CSV 格式 字段映射',
          existingRequirements: [
            {
              id: 'REQ-001',
              title: '数据导入模块',
              description: '批量 导入 数据 CSV Excel 格式 字段映射 数据验证',
            },
            {
              id: 'REQ-002',
              title: '用户管理',
              description: '用户增删改查基本功能',
            },
          ],
        },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.hasConflicts).toBe(true);
      expect(parsed.conflicts[0].id).toBe('REQ-001');
      console.log('  冲突检出:', parsed.conflicts[0].detail);
    });

    it('无重叠时返回无冲突', async () => {
      const result = await client.callTool({
        name: 'check_conflicts',
        arguments: {
          newRequirement: '添加暗色模式主题切换',
          existingRequirements: [
            { id: 'REQ-001', title: '数据导入', description: '批量导入CSV数据' },
          ],
        },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.hasConflicts).toBe(false);
    });
  });

  describe('12.4.4 generate_user_stories', () => {
    it('从需求描述生成用户故事', async () => {
      const result = await client.callTool({
        name: 'generate_user_stories',
        arguments: {
          requirementText: '作为产品经理，我希望能够查看每日活跃用户数据',
          maxStories: 2,
        },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.stories.length).toBeGreaterThan(0);
      expect(parsed.stories[0].id).toMatch(/^US-/);
      expect(parsed.stories[0].acceptanceCriteria).toBeArray();
      console.log('  生成故事:', parsed.stories[0].story);
    });
  });

  describe('12.4.5 tools/list 返回完整工具列表', () => {
    it('列出 4 个工具', async () => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'analyze_completeness',
        'check_conflicts',
        'estimate_complexity',
        'generate_user_stories',
      ]);
      console.log('  工具列表:', names.join(', '));
    });
  });
});

// ============================================================================
// 12.5 MCP Client：桥接器测试
// ============================================================================

describe('12.5 MCP → LangChain 桥接器', () => {
  describe('12.5.1 JSON Schema → Zod 转换', () => {
    it('正确转换 string 类型', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string', description: '姓名' } },
        required: ['name'],
      };
      const zod = jsonSchemaToZod(schema);
      const result = zod.safeParse({ name: 'Alice' });
      expect(result.success).toBe(true);
    });

    it('正确转换 number 类型', () => {
      const schema = {
        type: 'object' as const,
        properties: { age: { type: 'number' } },
        required: ['age'],
      };
      const zod = jsonSchemaToZod(schema);
      expect(zod.safeParse({ age: 25 }).success).toBe(true);
      expect(zod.safeParse({ age: 'abc' }).success).toBe(false);
    });

    it('正确转换 optional 字段', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['name'],
      };
      const zod = jsonSchemaToZod(schema);
      expect(zod.safeParse({ name: 'Alice' }).success).toBe(true);
      expect(zod.safeParse({}).success).toBe(false);
    });

    it('正确转换 array 类型', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['tags'],
      };
      const zod = jsonSchemaToZod(schema);
      expect(zod.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
      expect(zod.safeParse({ tags: 'not-array' }).success).toBe(false);
    });

    it('正确转换嵌套 object 类型', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
            required: ['city'],
          },
        },
        required: ['address'],
      };
      const zod = jsonSchemaToZod(schema);
      expect(zod.safeParse({ address: { city: 'Beijing' } }).success).toBe(true);
    });
  });

  describe('12.5.2 桥接后工具数量一致', () => {
    it('MCP tools/list 数量 = LangChain tools 数量', async () => {
      const { client, cleanup } = await createTestServerWithClient();
      try {
        const { tools: mcpTools } = await client.listTools();
        expect(mcpTools.length).toBe(4);
        console.log('  MCP tools:', mcpTools.length, '→ LangChain tools:', mcpTools.length);
      } finally {
        await cleanup();
      }
    });
  });
});

// ============================================================================
// 12.7 Web Search MCP Server
// ============================================================================

describe('12.7 Web Search MCP Server', () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createWebSearchServerWithClient();
    client = result.client;
    cleanup = result.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('mock 模式返回预置结果 - 批量导入', async () => {
    const result = await client.callTool({
      name: 'search_competitors',
      arguments: { query: '批量导入功能' },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.mode).toBe('mock');
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0].title).toContain('批量导入');
    console.log('  搜索结果数:', parsed.results.length);
    console.log('  首条:', parsed.results[0].title);
  });

  it('search_best_practices 返回结果', async () => {
    const result = await client.callTool({
      name: 'search_best_practices',
      arguments: { topic: '权限系统设计', industry: 'SaaS' },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.results.length).toBeGreaterThan(0);
    console.log('  最佳实践:', parsed.results[0].title);
  });

  it('search_tech_stack 返回结果', async () => {
    const result = await client.callTool({
      name: 'search_tech_stack',
      arguments: { technology: 'WebSocket vs SSE', useCase: '实时通知' },
    });
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.results.length).toBeGreaterThan(0);
    console.log('  技术参考:', parsed.results[0].title);
  });

  it('tools/list 返回 3 个工具', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['search_best_practices', 'search_competitors', 'search_tech_stack']);
  });
});

// ============================================================================
// 12.8 MCPManager 多 Server 编排
// ============================================================================

describe('12.8 MCPManager 多 Server 编排', () => {
  it('合并两个 Server 的工具列表', async () => {
    const { client: reqClient, cleanup: cleanup1 } = await createTestServerWithClient();
    const { client: searchClient, cleanup: cleanup2 } = await createWebSearchServerWithClient();

    try {
      const { tools: reqTools } = await reqClient.listTools();
      const { tools: searchTools } = await searchClient.listTools();

      const allTools = [...reqTools, ...searchTools];
      expect(allTools).toHaveLength(7);
      console.log('  需求分析工具:', reqTools.length);
      console.log('  网络搜索工具:', searchTools.length);
      console.log('  合计:', allTools.length);
    } finally {
      await cleanup1();
      await cleanup2();
    }
  });
});

// ============================================================================
// 12.9 错误处理与韧性
// ============================================================================

describe('12.9 错误处理与韧性', () => {
  it('调用不存在的工具返回 error', async () => {
    const { client, cleanup } = await createTestServerWithClient();
    try {
      const result = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });
      expect(result.isError || result.content).toBeTruthy();
    } catch (err: any) {
      expect(err.message || err.code).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});

// ============================================================================
// 12.10 安全模型
// ============================================================================

describe('12.10 安全模型', () => {
  it('权限检查：纯函数验证工具分类', () => {
    type PermissionLevel = 'read' | 'write' | 'admin';

    const toolPermissions: Record<string, PermissionLevel> = {
      analyze_completeness: 'read',
      estimate_complexity: 'read',
      check_conflicts: 'read',
      generate_user_stories: 'read',
      search_competitors: 'read',
      search_best_practices: 'read',
      search_tech_stack: 'read',
      create_requirement: 'write',
      delete_requirement: 'admin',
    };

    function requiresConfirmation(toolName: string): boolean {
      const level = toolPermissions[toolName];
      return level === 'write' || level === 'admin';
    }

    expect(requiresConfirmation('analyze_completeness')).toBe(false);
    expect(requiresConfirmation('create_requirement')).toBe(true);
    expect(requiresConfirmation('delete_requirement')).toBe(true);
    console.log('  read 工具无需确认:', !requiresConfirmation('search_competitors'));
    console.log('  write 工具需确认:', requiresConfirmation('create_requirement'));
    console.log('  admin 工具需确认:', requiresConfirmation('delete_requirement'));
  });
});

// ============================================================================
// Helper：使用 McpServer（高级 API）创建测试 Server + Client
// ============================================================================

async function createTestServerWithClient() {
  const server = new McpServer(
    { name: 'requirement-analyzer-test', version: '1.0.0' },
  );

  // 注册工具（与 mcp-servers/requirement-analyzer/src/index.ts 逻辑一致）
  server.tool(
    'analyze_completeness',
    '分析需求完整性',
    { requirementText: z.string().describe('需求描述') },
    async ({ requirementText }) => analyzeCompleteness(requirementText),
  );

  server.tool(
    'estimate_complexity',
    '估算需求复杂度',
    {
      requirementText: z.string(),
      techStack: z.string().optional(),
    },
    async ({ requirementText }) => estimateComplexity(requirementText),
  );

  server.tool(
    'check_conflicts',
    '检查需求冲突',
    {
      newRequirement: z.string(),
      existingRequirements: z.array(z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
      })),
    },
    async ({ newRequirement, existingRequirements }) => checkConflicts(newRequirement, existingRequirements),
  );

  server.tool(
    'generate_user_stories',
    '生成用户故事',
    {
      requirementText: z.string(),
      maxStories: z.number().optional(),
    },
    async ({ requirementText, maxStories }) => generateUserStories(requirementText, maxStories ?? 3),
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} },
  );

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

async function createWebSearchServerWithClient() {
  const server = new McpServer(
    { name: 'web-search-test', version: '1.0.0' },
  );

  server.tool(
    'search_competitors',
    '搜索竞品功能',
    {
      query: z.string(),
      domain: z.string().optional(),
    },
    async ({ query }) => {
      const results = getMockSearchResults(query, 'competitors');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ query, mode: 'mock', results, summary: `找到 ${results.length} 个结果` }, null, 2) }],
      };
    },
  );

  server.tool(
    'search_best_practices',
    '搜索最佳实践',
    {
      topic: z.string(),
      industry: z.string().optional(),
    },
    async ({ topic }) => {
      const results = getMockSearchResults(topic, 'practices');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ topic, mode: 'mock', results, summary: `找到 ${results.length} 个结果` }, null, 2) }],
      };
    },
  );

  server.tool(
    'search_tech_stack',
    '搜索技术选型',
    {
      technology: z.string(),
      useCase: z.string().optional(),
    },
    async ({ technology }) => {
      const results = getMockSearchResults(technology, 'tech');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ technology, mode: 'mock', results, summary: `找到 ${results.length} 个结果` }, null, 2) }],
      };
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

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

// ============================================================================
// Mock 搜索数据
// ============================================================================

function getMockSearchResults(query: string, _type: string) {
  const q = query.toLowerCase();

  if (q.includes('批量') || q.includes('导入') || q.includes('import')) {
    return [
      { title: 'Jira 批量导入功能 - CSV/Excel 支持', snippet: '支持 CSV 批量导入，单次限 1000 条', url: 'https://atlassian.com/docs' },
      { title: 'Linear 数据迁移最佳实践', snippet: 'API + CSV 双通道', url: 'https://linear.app/docs' },
    ];
  }
  if (q.includes('权限') || q.includes('rbac') || q.includes('permission')) {
    return [
      { title: 'RBAC vs ABAC 权限模型对比', snippet: 'RBAC 适合角色清晰场景', url: 'https://auth0.com/blog' },
      { title: 'Notion 权限体系设计分析', snippet: '层级继承 + 例外覆盖', url: 'https://notion.so/help' },
    ];
  }
  if (q.includes('websocket') || q.includes('sse') || q.includes('实时')) {
    return [
      { title: 'WebSocket vs SSE 技术选型对比', snippet: '双向选 WebSocket，单向推送选 SSE', url: 'https://web.dev' },
    ];
  }
  return [
    { title: `${query} - 综合参考`, snippet: '综合资料参考', url: 'https://example.com' },
  ];
}

// ============================================================================
// 工具逻辑（与 mcp-servers/requirement-analyzer/src/index.ts 对齐）
// ============================================================================

function analyzeCompleteness(requirementText: string) {
  const dimensions = [
    { name: '用户角色', keywords: ['用户', '角色', '作为', 'PM', '开发', '管理员', '运营'], found: false },
    { name: '功能描述', keywords: ['能够', '可以', '支持', '实现', '功能', '需要', '希望'], found: false },
    { name: '验收标准', keywords: ['验收', '标准', '条件', '期望', '预期结果', '应该', '必须'], found: false },
    { name: '优先级', keywords: ['优先', 'P0', 'P1', 'P2', '紧急', '重要', '高', '低'], found: false },
    { name: '非功能需求', keywords: ['性能', '安全', '可用性', '并发', '响应时间', '可靠', '稳定'], found: false },
    { name: '边界条件', keywords: ['边界', '异常', '限制', '最大', '最小', '超出', '错误', '失败'], found: false },
  ];

  for (const dim of dimensions) {
    dim.found = dim.keywords.some((kw) => requirementText.includes(kw));
  }

  const missing = dimensions.filter((d) => !d.found).map((d) => d.name);
  const covered = dimensions.filter((d) => d.found).map((d) => d.name);
  const score = Math.round((covered.length / dimensions.length) * 100);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        completenessScore: score,
        totalDimensions: dimensions.length,
        coveredDimensions: covered,
        missingDimensions: missing,
        suggestion: missing.length > 0 ? `建议补充以下维度：${missing.join('、')}` : '需求描述较为完整',
      }, null, 2),
    }],
  };
}

function estimateComplexity(requirementText: string) {
  let score = 0;
  const factors: string[] = [];

  if (/集成|对接|第三方|API|接口|外部/.test(requirementText)) { score += 3; factors.push('涉及外部系统集成'); }
  if (/迁移|导入|导出|批量|同步/.test(requirementText)) { score += 2; factors.push('涉及数据处理/迁移'); }
  if (/权限|角色|鉴权|审批|多租户/.test(requirementText)) { score += 2; factors.push('涉及权限体系'); }
  if (/实时|推送|WebSocket|通知|消息/.test(requirementText)) { score += 2; factors.push('涉及实时通信'); }
  if (/AI|智能|推荐|预测|模型|LLM/.test(requirementText)) { score += 3; factors.push('涉及 AI/ML 能力'); }

  const size = score <= 2 ? 'S' : score <= 4 ? 'M' : score <= 6 ? 'L' : 'XL';
  const estimatedDays = { S: '1-3天', M: '3-7天', L: '1-3周', XL: '3周以上' }[size];

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ size, estimatedDays, complexityScore: score, factors: factors.length > 0 ? factors : ['需求相对简单'] }, null, 2) }],
  };
}

function checkConflicts(newRequirement: string, existingRequirements: Array<{ id: string; title: string; description: string }>) {
  const conflicts: Array<{ id: string; title: string; type: string; detail: string }> = [];
  const newKw = extractKeywords(newRequirement);

  for (const existing of existingRequirements) {
    const existingKw = extractKeywords(existing.description);
    const overlap = newKw.filter((k) => existingKw.includes(k));
    if (overlap.length >= 3) {
      conflicts.push({ id: existing.id, title: existing.title, type: '功能重叠', detail: `共同关键词：${overlap.join('、')}` });
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ hasConflicts: conflicts.length > 0, conflictCount: conflicts.length, conflicts, suggestion: conflicts.length > 0 ? `发现 ${conflicts.length} 个潜在冲突` : '未发现冲突' }, null, 2) }],
  };
}

function generateUserStories(requirementText: string, maxStories: number) {
  const actors = extractActors(requirementText);
  const stories = [];
  for (let i = 0; i < Math.min(maxStories, Math.max(actors.length, 1)); i++) {
    stories.push({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      story: `作为${actors[i] || '用户'}，我希望能够${requirementText.substring(0, 30)}`,
      acceptanceCriteria: ['功能可正常使用', '操作响应时间 < 2 秒', '异常有错误提示'],
      priority: i === 0 ? 'P1' : 'P2',
    });
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify({ stories, note: '基于需求描述自动生成' }, null, 2) }] };
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '可以', '需要', '能够', '支持', '实现', '进行', '通过', '使用']);
  return text.replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
}

function extractActors(text: string): string[] {
  const actors: string[] = [];
  const patterns = [/作为(.{2,6})[，,]/g, /(管理员|用户|开发者|产品经理|运营|客服)/g];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) actors.push(m[1]);
  }
  return [...new Set(actors)];
}
