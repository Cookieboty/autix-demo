/**
 * Web Search MCP Server
 *
 * 网络搜索 MCP Server —— 为需求分析提供竞品调研、最佳实践搜索、技术选型参考。
 * 底层对接 Tavily Search API；无 API Key 时自动降级为 Mock 模式。
 *
 * 与第十一章 CRAG 的 Web 兜底路径形成标准化封装：
 * 同样的搜索能力，MCP 化后可跨 Agent 复用。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const IS_MOCK = !TAVILY_API_KEY;

const server = new McpServer({
  name: 'web-search',
  version: '1.0.0',
});

// ============================================================================
// Tool 1: 搜索竞品功能
// ============================================================================

server.tool(
  'search_competitors',
  '搜索竞品的相关功能实现，了解市场上类似产品的做法。适用于需求分析时调研竞品如何实现类似功能。',
  {
    query: z.string().describe('搜索关键词，如"Jira 批量导入功能"、"Notion AI 写作助手"'),
    domain: z.string().optional().describe('限定搜索域名，如"atlassian.com"'),
  },
  async ({ query, domain }) => {
    const searchQuery = `${query} product feature implementation`;
    const results = await doSearch(searchQuery, domain);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              query,
              mode: IS_MOCK ? 'mock' : 'live',
              results: results.map((r) => ({
                title: r.title,
                snippet: r.snippet,
                url: r.url,
              })),
              summary: results.length > 0
                ? `找到 ${results.length} 个竞品参考，涵盖：${results.map((r) => r.title).join('、')}`
                : '未找到相关竞品信息',
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ============================================================================
// Tool 2: 搜索行业最佳实践
// ============================================================================

server.tool(
  'search_best_practices',
  '搜索特定领域的行业最佳实践和设计模式。适用于需求设计阶段参考业界标准做法。',
  {
    topic: z.string().describe('主题，如"批量数据导入"、"权限系统设计"、"实时通知架构"'),
    industry: z.string().optional().describe('行业领域，如"SaaS"、"电商"、"金融"'),
  },
  async ({ topic, industry }) => {
    const searchQuery = industry
      ? `${topic} best practices ${industry} industry`
      : `${topic} best practices software engineering`;
    const results = await doSearch(searchQuery);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              topic,
              industry: industry || '通用',
              mode: IS_MOCK ? 'mock' : 'live',
              results: results.map((r) => ({
                title: r.title,
                snippet: r.snippet,
                url: r.url,
              })),
              summary: results.length > 0
                ? `找到 ${results.length} 篇最佳实践参考`
                : '未找到相关最佳实践',
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ============================================================================
// Tool 3: 搜索技术选型参考
// ============================================================================

server.tool(
  'search_tech_stack',
  '搜索特定技术的选型对比和实践经验。适用于估算复杂度时参考类似技术方案的工期和风险。',
  {
    technology: z.string().describe('技术关键词，如"WebSocket vs SSE"、"PostgreSQL 全文检索"'),
    useCase: z.string().optional().describe('使用场景，如"万级并发推送"、"百万级数据导入"'),
  },
  async ({ technology, useCase }) => {
    const searchQuery = useCase
      ? `${technology} ${useCase} architecture comparison`
      : `${technology} production experience comparison`;
    const results = await doSearch(searchQuery);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              technology,
              useCase: useCase || '通用',
              mode: IS_MOCK ? 'mock' : 'live',
              results: results.map((r) => ({
                title: r.title,
                snippet: r.snippet,
                url: r.url,
              })),
              summary: results.length > 0
                ? `找到 ${results.length} 篇技术选型参考`
                : '未找到相关技术参考',
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ============================================================================
// 搜索实现：Tavily API / Mock
// ============================================================================

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

async function doSearch(query: string, domain?: string): Promise<SearchResult[]> {
  if (IS_MOCK) {
    return getMockResults(query);
  }
  return tavilySearch(query, domain);
}

async function tavilySearch(query: string, domain?: string): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    max_results: 5,
    search_depth: 'basic',
  };
  if (domain) {
    body.include_domains = [domain];
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`Tavily API error: ${res.status} ${res.statusText}`);
    return getMockResults(query);
  }

  const data = (await res.json()) as { results: Array<{ title: string; content: string; url: string }> };
  return data.results.map((r) => ({
    title: r.title,
    snippet: r.content.substring(0, 200),
    url: r.url,
  }));
}

function getMockResults(query: string): SearchResult[] {
  const queryLower = query.toLowerCase();

  if (queryLower.includes('批量') || queryLower.includes('import') || queryLower.includes('导入')) {
    return [
      {
        title: 'Jira 批量导入功能 - CSV/Excel 格式支持',
        snippet: 'Jira 支持通过 CSV 文件批量导入 Issue，包含字段映射、数据验证、冲突处理等完整流程。单次导入限制 1000 条，超过需分批处理。',
        url: 'https://support.atlassian.com/jira/docs/import-data',
      },
      {
        title: 'Linear - 批量数据迁移最佳实践',
        snippet: 'Linear 提供 API 和 CSV 两种导入方式。API 方式支持增量同步，CSV 方式适合一次性迁移。建议先导入少量数据验证映射正确性。',
        url: 'https://linear.app/docs/import',
      },
      {
        title: '大规模数据导入架构设计 - 异步队列模式',
        snippet: '生产环境批量导入推荐使用异步队列 + Worker 模式：前端上传 → 解析验证 → 入队列 → Worker 分批写入 → WebSocket 通知完成。',
        url: 'https://engineering.example.com/bulk-import-architecture',
      },
    ];
  }

  if (queryLower.includes('权限') || queryLower.includes('permission') || queryLower.includes('rbac')) {
    return [
      {
        title: 'RBAC vs ABAC vs ReBAC - 权限模型对比',
        snippet: 'RBAC 适合角色清晰的场景；ABAC 适合细粒度动态策略；ReBAC 适合社交/协作场景。中小型 SaaS 推荐从 RBAC 起步。',
        url: 'https://auth0.com/blog/rbac-vs-abac',
      },
      {
        title: 'Notion 权限体系设计分析',
        snippet: 'Notion 采用层级继承 + 例外覆盖的混合模型：Workspace → Team → Page 三级继承，每级可独立设置 Guest 和 Member 角色。',
        url: 'https://www.notion.so/help/sharing-and-permissions',
      },
    ];
  }

  if (queryLower.includes('实时') || queryLower.includes('websocket') || queryLower.includes('推送')) {
    return [
      {
        title: 'WebSocket vs SSE vs Long Polling 技术选型',
        snippet: '双向通信选 WebSocket；服务端单向推送选 SSE（更简单、自动重连）；兼容老浏览器选 Long Polling。SSE 在大多数通知场景够用。',
        url: 'https://web.dev/articles/eventsource-basics',
      },
      {
        title: '百万连接 WebSocket 架构 - 分层网关设计',
        snippet: '超过 10 万连接时需引入网关层：接入网关（维持连接）→ 业务网关（路由消息）→ 后端服务。每层可独立水平扩展。',
        url: 'https://engineering.example.com/million-websocket',
      },
    ];
  }

  return [
    {
      title: `${query} - 综合参考`,
      snippet: `关于"${query}"的综合资料。建议参考官方文档和社区最佳实践进行深入调研。`,
      url: 'https://example.com/search?q=' + encodeURIComponent(query),
    },
  ];
}

// ============================================================================
// 启动 Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Web Search MCP Server running on stdio (mode: ${IS_MOCK ? 'mock' : 'live'})`);
}

main().catch(console.error);
