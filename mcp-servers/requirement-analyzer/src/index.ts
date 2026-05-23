/**
 * Requirement Analyzer MCP Server
 *
 * 需求分析 MCP Server —— 暴露需求完整性分析、复杂度估算、冲突检查、用户故事生成四个工具，
 * 加上 PRD 模板和验收标准两个 Resource，以及一个需求分析 Prompt 模板。
 *
 * 传输方式：stdio（开发）/ Streamable HTTP（生产）
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'requirement-analyzer',
  version: '1.0.0',
});

// ============================================================================
// Tool 1: 需求完整性分析
// ============================================================================

server.tool(
  'analyze_completeness',
  '分析需求描述的完整性，检查是否缺少关键维度（用户角色、功能描述、验收标准、非功能需求等）',
  {
    requirementText: z.string().describe('需求描述文本'),
  },
  async ({ requirementText }) => {
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
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              completenessScore: score,
              totalDimensions: dimensions.length,
              coveredDimensions: covered,
              missingDimensions: missing,
              suggestion:
                missing.length > 0
                  ? `建议补充以下维度：${missing.join('、')}`
                  : '需求描述较为完整',
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
// Tool 2: 复杂度估算
// ============================================================================

server.tool(
  'estimate_complexity',
  '估算需求的技术复杂度，返回 T-shirt size（S/M/L/XL）和估算依据',
  {
    requirementText: z.string().describe('需求描述文本'),
    techStack: z.string().optional().describe('技术栈（可选，用于更精确的估算）'),
  },
  async ({ requirementText }) => {
    let score = 0;
    const factors: string[] = [];

    if (/集成|对接|第三方|API|接口|外部/.test(requirementText)) {
      score += 3;
      factors.push('涉及外部系统集成');
    }
    if (/迁移|导入|导出|批量|同步|Excel|CSV/.test(requirementText)) {
      score += 2;
      factors.push('涉及数据处理/迁移');
    }
    if (/权限|角色|鉴权|审批|多租户/.test(requirementText)) {
      score += 2;
      factors.push('涉及权限体系');
    }
    if (/实时|推送|WebSocket|通知|消息/.test(requirementText)) {
      score += 2;
      factors.push('涉及实时通信');
    }
    if (/AI|智能|推荐|预测|模型|LLM/.test(requirementText)) {
      score += 3;
      factors.push('涉及 AI/ML 能力');
    }
    if (/加密|安全|合规|审计/.test(requirementText)) {
      score += 1;
      factors.push('有安全合规要求');
    }
    if (requirementText.length > 500) {
      score += 1;
      factors.push('需求描述较长，可能涉及多个子功能');
    }

    const size = score <= 2 ? 'S' : score <= 4 ? 'M' : score <= 6 ? 'L' : 'XL';
    const estimatedDays = { S: '1-3天', M: '3-7天', L: '1-3周', XL: '3周以上' }[size];

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              size,
              estimatedDays,
              complexityScore: score,
              factors: factors.length > 0 ? factors : ['需求相对简单，无明显复杂因素'],
              suggestion:
                size === 'XL'
                  ? '建议拆分为多个子需求分批交付'
                  : `复杂度适中，预计 ${estimatedDays} 可完成`,
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
// Tool 3: 需求冲突检查
// ============================================================================

server.tool(
  'check_conflicts',
  '检查新需求是否与现有需求存在功能重叠或逻辑冲突',
  {
    newRequirement: z.string().describe('新的需求描述'),
    existingRequirements: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
        }),
      )
      .describe('现有需求列表'),
  },
  async ({ newRequirement, existingRequirements }) => {
    const conflicts: Array<{ id: string; title: string; type: string; detail: string }> = [];
    const newKeywords = extractKeywords(newRequirement);

    for (const existing of existingRequirements) {
      const existingKeywords = extractKeywords(existing.description);
      const overlap = newKeywords.filter((k) => existingKeywords.includes(k));

      if (overlap.length >= 3) {
        conflicts.push({
          id: existing.id,
          title: existing.title,
          type: '功能重叠',
          detail: `共同关键词：${overlap.join('、')}`,
        });
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              hasConflicts: conflicts.length > 0,
              conflictCount: conflicts.length,
              conflicts,
              suggestion:
                conflicts.length > 0
                  ? `发现 ${conflicts.length} 个潜在冲突，建议与相关需求负责人确认`
                  : '未发现与现有需求的明显冲突',
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
// Tool 4: 生成用户故事
// ============================================================================

server.tool(
  'generate_user_stories',
  '从需求描述生成标准格式的用户故事（User Story）',
  {
    requirementText: z.string().describe('需求描述文本'),
    maxStories: z.number().optional().describe('最多生成几个用户故事，默认 3'),
  },
  async ({ requirementText, maxStories = 3 }) => {
    const actors = extractActors(requirementText);
    const actions = extractActions(requirementText);

    const stories = [];
    for (let i = 0; i < Math.min(maxStories, Math.max(actors.length, 1)); i++) {
      const actor = actors[i] || '用户';
      const action = actions[i] || requirementText.substring(0, 50);
      stories.push({
        id: `US-${String(i + 1).padStart(3, '0')}`,
        story: `作为${actor}，我希望能够${action}，以便提高工作效率`,
        acceptanceCriteria: [
          '功能可在主界面直接访问',
          '操作响应时间 < 2 秒',
          '异常情况有明确的错误提示',
        ],
        priority: i === 0 ? 'P1' : 'P2',
      });
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              stories,
              note: '基于需求描述自动生成，请根据实际业务场景调整验收标准和优先级',
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
// Resource: PRD 模板
// ============================================================================

server.resource('requirement://templates/prd', 'PRD（产品需求文档）标准模板', async () => ({
  contents: [
    {
      uri: 'requirement://templates/prd',
      mimeType: 'text/markdown',
      text: `# PRD: [需求标题]

## 1. 背景与目标
- 业务背景：
- 用户痛点：
- 预期目标：

## 2. 用户角色
| 角色 | 描述 | 核心诉求 |
|------|------|----------|

## 3. 功能需求
### 3.1 核心功能
### 3.2 辅助功能

## 4. 非功能需求
- 性能：
- 安全：
- 可用性：

## 5. 验收标准
- Given [前置条件]
- When [用户操作]
- Then [预期结果]

## 6. 排期与里程碑`,
    },
  ],
}));

// ============================================================================
// Resource: 验收标准规范
// ============================================================================

server.resource(
  'requirement://standards/acceptance-criteria',
  '验收标准编写规范',
  async () => ({
    contents: [
      {
        uri: 'requirement://standards/acceptance-criteria',
        mimeType: 'text/markdown',
        text: `# 验收标准编写规范

## Given-When-Then 格式
- Given [前置条件]
- When [用户操作]
- Then [预期结果]

## 检查清单
- [ ] 是否覆盖了正常流程
- [ ] 是否覆盖了异常流程
- [ ] 是否定义了边界条件
- [ ] 是否包含性能指标
- [ ] 是否可自动化测试

## 示例
Given 用户已登录且有管理员权限
When 用户点击「批量导入」并上传 1000 条数据的 CSV 文件
Then 系统在 30 秒内完成导入，并显示成功导入的条数和失败条数`,
      },
    ],
  }),
);

// ============================================================================
// Prompt: 需求分析模板
// ============================================================================

server.prompt(
  'analyze_requirement',
  '需求分析的标准 Prompt 模板，引导 LLM 对一段需求做全面分析',
  { requirementText: z.string().describe('需要分析的需求描述') },
  async ({ requirementText }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `请对以下需求进行全面分析：

【需求描述】
${requirementText}

请从以下维度分析：
1. 完整性：是否缺少用户角色、功能边界、验收标准、非功能需求？
2. 可行性：技术复杂度如何？有哪些技术风险？
3. 优先级建议：基于业务价值和技术成本给出 P0/P1/P2 建议
4. 拆分建议：如果需求过大，建议如何拆分为可独立交付的子需求？
5. 潜在风险：时间风险、技术风险、依赖风险`,
        },
      },
    ],
  }),
);

// ============================================================================
// 辅助函数
// ============================================================================

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
    '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '什么',
    '可以', '需要', '能够', '支持', '实现', '进行', '通过', '使用',
  ]);
  return text
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

function extractActors(text: string): string[] {
  const actorPatterns = [
    /作为(.{2,6})[，,]/g,
    /(管理员|用户|开发者|产品经理|运营|客服|审核员)/g,
  ];
  const actors: string[] = [];
  for (const pattern of actorPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      actors.push(match[1]);
    }
  }
  return [...new Set(actors)];
}

function extractActions(text: string): string[] {
  const actionPatterns = [
    /能够(.{5,30})[，。,.\s]/g,
    /可以(.{5,30})[，。,.\s]/g,
    /支持(.{5,30})[，。,.\s]/g,
    /希望(.{5,30})[，。,.\s]/g,
  ];
  const actions: string[] = [];
  for (const pattern of actionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      actions.push(match[1]);
    }
  }
  return [...new Set(actions)];
}

// ============================================================================
// 启动 Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Requirement Analyzer MCP Server running on stdio');
}

main().catch(console.error);
