/**
 * chapter10-token-economics.spec.ts
 *
 * 第十章《上下文是稀缺资源——Token 经济学》配套测试用例
 *
 * 设计目标：
 * - **按文档章节组织**：每个 describe 标题以「10.x.y」开头
 * - **零依赖**：单元测试用 mock，无需 LLM API key 或数据库
 * - **效果可视化**：打印关键数据，读者能看到"哪个节点最贵、裁剪前后省了多少"
 */
import { describe, it, expect, mock } from 'bun:test';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import { estimateTextTokens, estimateGraphNodeCost, getModelPricing } from '../src/llm/cost/token-estimator';
import { TokenUsageService } from '../src/llm/cost/token-usage.service';
import { withTokenUsage } from '../src/llm/cost/with-token-usage';
import { trimMessagesForContext } from '../src/llm/context/message-trimmer';
import { compressConversation, type SummaryModel } from '../src/llm/context/conversation-compressor';
import { resolveModelForAgent, DEFAULT_AGENT_MODEL_SET, type AgentName } from '../src/llm/cost/agent-model-set';
import { resolveBudgetAction } from '../src/llm/cost/budget-policy';

function logSection(title: string) {
  console.log(`\n  ─── ${title} ───`);
}

// ============================================================================
// 10.2 Token 估算器
// ============================================================================

describe('10.2.1 Token 估算器 - estimateTextTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('null/undefined 返回 0', () => {
    expect(estimateTextTokens(null as any)).toBe(0);
    expect(estimateTextTokens(undefined as any)).toBe(0);
  });

  it('中文需求文本能估算出大于 0 的 token', () => {
    const text = '新增批量导入 Excel，支持 10 万行数据校验';
    const tokens = estimateTextTokens(text);
    logSection('中文文本估算');
    console.log(`  文本: "${text}"`);
    console.log(`  估算 tokens: ${tokens}`);
    expect(tokens).toBeGreaterThan(0);
  });

  it('纯英文文本每 4 字符约 1 token', () => {
    const text = 'Hello World Test'; // 16 chars => ~4 tokens
    const tokens = estimateTextTokens(text);
    logSection('英文文本估算');
    console.log(`  文本: "${text}" (${text.length} chars)`);
    console.log(`  估算 tokens: ${tokens}`);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length); // 应该小于字符数
  });
});

describe('10.2.1 estimateGraphNodeCost - 节点成本估算', () => {
  it('带 tools 的专家节点成本高于不带 tools 的节点', () => {
    const withTools = estimateGraphNodeCost({
      nodeName: 'functional_expert',
      modelName: 'gpt-4o',
      systemPrompt: '你是功能需求分析专家。',
      toolSchemas: JSON.stringify([
        { name: 'search_requirement', description: '搜索需求' },
        { name: 'check_conflicts', description: '检查冲突' },
        { name: 'read_feature_spec', description: '读取规格' },
      ]),
      outputText: '## 功能模块拆解\n- 模块A\n- 模块B',
    });

    const withoutTools = estimateGraphNodeCost({
      nodeName: 'aggregator',
      modelName: 'gpt-4o',
      systemPrompt: '你是功能需求分析专家。',
      outputText: '## 功能模块拆解\n- 模块A\n- 模块B',
    });

    logSection('工具对成本的影响');
    console.log(`  带 tools: inputTokens=${withTools.inputTokens}, cost=$${withTools.estimatedCostUsd.toFixed(6)}`);
    console.log(`  无 tools: inputTokens=${withoutTools.inputTokens}, cost=$${withoutTools.estimatedCostUsd.toFixed(6)}`);

    expect(withTools.inputTokens).toBeGreaterThan(withoutTools.inputTokens);
  });

  it('output token 按输出价格计算', () => {
    const result = estimateGraphNodeCost({
      nodeName: 'test',
      modelName: 'gpt-4o',
      systemPrompt: '',
      outputText: 'AAAA'.repeat(250), // ~250 tokens
    });

    const pricing = getModelPricing('gpt-4o');
    const outputCostPerToken = pricing.output / 1_000_000;
    const inputCostPerToken = pricing.input / 1_000_000;

    logSection('输出 vs 输入单价');
    console.log(`  输入单价: $${inputCostPerToken.toFixed(8)}/token`);
    console.log(`  输出单价: $${outputCostPerToken.toFixed(8)}/token`);
    console.log(`  输出比输入贵: ${(pricing.output / pricing.input).toFixed(1)}x`);

    expect(outputCostPerToken).toBeGreaterThan(inputCostPerToken);
  });
});

// ============================================================================
// 10.3 Multi-Agent 节点成本拆账
// ============================================================================

describe('10.3 Multi-Agent 节点成本拆账', () => {
  it('能聚合多节点 usage 并找出最贵节点', () => {
    const nodes = [
      { nodeName: 'supervisor', inputTokens: 1500, outputTokens: 100 },
      { nodeName: 'functional_expert', inputTokens: 2500, outputTokens: 600 },
      { nodeName: 'performance_expert', inputTokens: 2200, outputTokens: 500 },
      { nodeName: 'security_expert', inputTokens: 3200, outputTokens: 800 },
      { nodeName: 'aggregator', inputTokens: 1800, outputTokens: 200 },
    ];

    const pricing = getModelPricing('gpt-4o');
    const costs = nodes.map((n) => ({
      ...n,
      cost:
        (n.inputTokens / 1_000_000) * pricing.input +
        (n.outputTokens / 1_000_000) * pricing.output,
    }));

    const totalCost = costs.reduce((s, c) => s + c.cost, 0);
    const totalInput = nodes.reduce((s, n) => s + n.inputTokens, 0);
    const totalOutput = nodes.reduce((s, n) => s + n.outputTokens, 0);
    const sorted = costs.sort((a, b) => b.cost - a.cost);

    logSection('节点成本拆账');
    for (const c of sorted) {
      console.log(`  ${c.nodeName}: $${c.cost.toFixed(6)} (in=${c.inputTokens}, out=${c.outputTokens})`);
    }
    console.log(`  ──────────`);
    console.log(`  总计: $${totalCost.toFixed(6)} (in=${totalInput}, out=${totalOutput})`);

    expect(totalCost).toBeGreaterThan(0);
    expect(sorted[0].nodeName).toBe('security_expert');
  });
});

// ============================================================================
// 10.5.1 message-trimmer
// ============================================================================

describe('10.5.1 message-trimmer', () => {
  it('保留 system message', () => {
    const msgs = [
      new SystemMessage('你是助手'),
      new HumanMessage('你好'),
      new AIMessage('你好！'),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 1 });
    expect(trimmed[0]).toBeInstanceOf(SystemMessage);
  });

  it('只保留最近 N 条非 system 消息', () => {
    const msgs = [
      new SystemMessage('系统'),
      new HumanMessage('消息1'),
      new AIMessage('回复1'),
      new HumanMessage('消息2'),
      new AIMessage('回复2'),
      new HumanMessage('消息3'),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 2 });

    logSection('消息裁剪');
    console.log(`  原始消息数: ${msgs.length}`);
    console.log(`  裁剪后: ${trimmed.length} (1 system + 2 recent)`);

    // system + 最近2条
    const nonSystem = trimmed.filter((m) => !(m instanceof SystemMessage));
    expect(nonSystem.length).toBeLessThanOrEqual(2);
  });

  it('删除孤立 ToolMessage', () => {
    const msgs = [
      new ToolMessage({ content: '孤立工具结果', tool_call_id: 'tc1' }),
      new HumanMessage('你好'),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 10 });
    const toolMsgs = trimmed.filter((m) => m instanceof ToolMessage);

    logSection('孤立 ToolMessage 清理');
    console.log(`  原始: ${msgs.length} 条 (含孤立 ToolMessage)`);
    console.log(`  裁剪后 ToolMessage 数: ${toolMsgs.length}`);

    expect(toolMsgs.length).toBe(0);
  });

  it('AIMessage(tool_calls) 与 ToolMessage 成对保留', () => {
    const aiWithToolCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'tc1', name: 'search', args: {}, type: 'tool_call' }],
    });
    const toolResult = new ToolMessage({ content: '搜索结果', tool_call_id: 'tc1' });

    const msgs = [
      new HumanMessage('搜索需求'),
      aiWithToolCall,
      toolResult,
      new AIMessage('分析完成'),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 10 });
    const hasAiWithTools = trimmed.some(
      (m) => m._getType() === 'ai' && (m as any).tool_calls?.length > 0,
    );
    const hasToolMsg = trimmed.some((m) => m instanceof ToolMessage);

    logSection('工具调用成对保留');
    console.log(`  AI(tool_calls) 存在: ${hasAiWithTools}`);
    console.log(`  ToolMessage 存在: ${hasToolMsg}`);

    // 两者要么都在，要么都不在
    expect(hasAiWithTools).toBe(hasToolMsg);
  });

  it('多个 ToolMessage 各自按 tool_call_id 精确配对', () => {
    const aiCallA = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_a', name: 'search', args: {}, type: 'tool_call' }],
    });
    const aiCallB = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_b', name: 'lookup', args: {}, type: 'tool_call' }],
    });

    const msgs = [
      aiCallA,
      // 注意：故意先放一个不属于 aiCallA 的孤立 ToolMessage（id 不匹配）
      new ToolMessage({ content: '错配工具结果', tool_call_id: 'call_zzz' }),
      new ToolMessage({ content: 'A 的结果', tool_call_id: 'call_a' }),
      aiCallB,
      new ToolMessage({ content: 'B 的结果', tool_call_id: 'call_b' }),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 20 });

    const toolMsgs = trimmed.filter((m) => m instanceof ToolMessage) as ToolMessage[];

    logSection('tool_call_id 精确配对');
    console.log(`  保留的 ToolMessage tool_call_ids: ${toolMsgs.map((m) => m.tool_call_id).join(', ')}`);

    expect(toolMsgs.map((m) => m.tool_call_id).sort()).toEqual(['call_a', 'call_b']);
  });

  it('AIMessage 的 tool_call.id 没有响应时整条被移除（避免 tool_calls 不完整）', () => {
    const incompleteAi = new AIMessage({
      content: '',
      tool_calls: [
        { id: 'call_x', name: 'search', args: {}, type: 'tool_call' },
        { id: 'call_y', name: 'lookup', args: {}, type: 'tool_call' },
      ],
    });
    const partialResp = new ToolMessage({ content: '只回了 x', tool_call_id: 'call_x' });

    const msgs = [
      new HumanMessage('请查两份资料'),
      incompleteAi,
      partialResp,
      new AIMessage('继续聊点别的'),
    ];
    const trimmed = trimMessagesForContext(msgs, { maxMessages: 20 });

    const aiWithToolCalls = trimmed.filter(
      (m) => m._getType() === 'ai' && (m as any).tool_calls?.length > 0,
    );
    const toolMsgs = trimmed.filter((m) => m instanceof ToolMessage);

    logSection('部分缺失的 tool_calls 整条移除');
    console.log(`  幸存 AIMessage(tool_calls): ${aiWithToolCalls.length}`);
    console.log(`  幸存 ToolMessage: ${toolMsgs.length}`);

    expect(aiWithToolCalls.length).toBe(0);
    expect(toolMsgs.length).toBe(0);
  });
});

// ============================================================================
// 10.5.2 conversation-compressor
// ============================================================================

describe('10.5.2 conversation-compressor', () => {
  const mockSummaryModel: SummaryModel = {
    invoke: mock(async () => ({
      content: '用户讨论了批量导入功能的需求，包括 Excel 支持和数据校验。',
    })),
  };

  it('短对话不触发压缩', async () => {
    const msgs = [
      new SystemMessage('系统'),
      new HumanMessage('你好'),
      new AIMessage('你好！'),
    ];
    const result = await compressConversation(msgs, mockSummaryModel, { keepRecent: 10 });
    expect(result).toEqual(msgs);
  });

  it('长对话触发 summaryModel.invoke', async () => {
    const msgs: BaseMessage[] = [new SystemMessage('系统')];
    for (let i = 0; i < 20; i++) {
      msgs.push(new HumanMessage(`问题${i}`));
      msgs.push(new AIMessage(`回答${i}`));
    }

    const result = await compressConversation(msgs, mockSummaryModel, { keepRecent: 4 });

    logSection('摘要压缩');
    console.log(`  原始消息数: ${msgs.length}`);
    console.log(`  压缩后消息数: ${result.length}`);

    expect(result.length).toBeLessThan(msgs.length);
    // 应包含 [对话摘要]
    const hasSummary = result.some(
      (m) => m instanceof SystemMessage && String(m.content).includes('[对话摘要]'),
    );
    expect(hasSummary).toBe(true);
  });

  it('返回结果包含摘要和最近消息', async () => {
    const msgs: BaseMessage[] = [];
    for (let i = 0; i < 15; i++) {
      msgs.push(new HumanMessage(`问题${i}`));
      msgs.push(new AIMessage(`回答${i}`));
    }

    const result = await compressConversation(msgs, mockSummaryModel, { keepRecent: 4 });
    const lastMsg = result[result.length - 1];

    // 最后一条应该是最近的消息
    expect(lastMsg.content).toContain('回答14');
  });
});

// ============================================================================
// 10.6.1 Prompt caching 稳定前缀
// ============================================================================

describe('10.6.4 Prompt Caching 稳定前缀', () => {
  it('system prompt + tools 在前缀位置保持稳定', () => {
    const systemPrompt = '你是需求分析专家。';
    const toolDefs = JSON.stringify([{ name: 'search', description: '搜索' }]);

    // 正确顺序：system → tools → history → input
    const call1 = [systemPrompt, toolDefs, '用户问题1'].join('|');
    const call2 = [systemPrompt, toolDefs, '用户问题2'].join('|');

    // 找出公共前缀长度
    let prefixLen = 0;
    for (let i = 0; i < Math.min(call1.length, call2.length); i++) {
      if (call1[i] === call2[i]) prefixLen++;
      else break;
    }

    const stableTokens = estimateTextTokens(call1.substring(0, prefixLen));
    const totalTokens1 = estimateTextTokens(call1);

    logSection('前缀稳定性');
    console.log(`  稳定前缀 tokens: ${stableTokens}`);
    console.log(`  总 tokens: ${totalTokens1}`);
    console.log(`  缓存命中率: ${((stableTokens / totalTokens1) * 100).toFixed(1)}%`);

    expect(stableTokens).toBeGreaterThan(0);
  });

  it('用户输入放前面会破坏前缀稳定性', () => {
    const systemPrompt = '你是需求分析专家。';

    // 错误顺序：input → system
    const bad1 = ['用户问题1', systemPrompt].join('|');
    const bad2 = ['用户问题2', systemPrompt].join('|');

    let badPrefixLen = 0;
    for (let i = 0; i < Math.min(bad1.length, bad2.length); i++) {
      if (bad1[i] === bad2[i]) badPrefixLen++;
      else break;
    }

    // 正确顺序
    const good1 = [systemPrompt, '用户问题1'].join('|');
    const good2 = [systemPrompt, '用户问题2'].join('|');

    let goodPrefixLen = 0;
    for (let i = 0; i < Math.min(good1.length, good2.length); i++) {
      if (good1[i] === good2[i]) goodPrefixLen++;
      else break;
    }

    logSection('前缀顺序对比');
    console.log(`  正确顺序 (system先): 公共前缀 ${goodPrefixLen} chars`);
    console.log(`  错误顺序 (input先): 公共前缀 ${badPrefixLen} chars`);

    expect(goodPrefixLen).toBeGreaterThan(badPrefixLen);
  });
});

// ============================================================================
// 10.8.2 TokenUsageService
// ============================================================================

describe('10.8.3 TokenUsageService - 数据库记录与聚合', () => {
  function createMockPrisma(records: any[] = []) {
    return {
      token_usages: {
        create: mock(async ({ data }: any) => {
          records.push({ ...data, createdAt: new Date() });
          return data;
        }),
        findMany: mock(async () => records),
      },
    } as any;
  }

  it('可记录一条节点 usage，并写入完整字段', async () => {
    const records: any[] = [];
    const service = new TokenUsageService(createMockPrisma(records));

    await service.recordUsage({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
      graphName: 'requirement-analysis',
      nodeName: 'security_expert',
      agentName: 'security_expert',
      modelConfigId: 'demo-gpt-4o',
      modelName: 'gpt-4o',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 100,
      estimatedCostUsd: 0.00425,
      isEstimated: false,
      latencyMs: 123,
      overrideReason: 'test_override',
    });

    logSection('TokenUsage 写入');
    console.log(`  node=${records[0].nodeName}, agent=${records[0].agentName}, cost=$${records[0].estimatedCostUsd}`);

    expect(records.length).toBe(1);
    expect(records[0].conversationId).toBe('conv-1');
    expect(records[0].totalTokens).toBe(1200);
    expect(records[0].overrideReason).toBe('test_override');
  });

  it('能按月聚合成本，并判断预算是否超限', async () => {
    const service = new TokenUsageService(
      createMockPrisma([
        { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 100, estimatedCostUsd: 0.01, createdAt: new Date() },
        { inputTokens: 2000, outputTokens: 300, cachedInputTokens: 0, estimatedCostUsd: 0.02, createdAt: new Date() },
      ]),
    );

    const stats = await service.getMonthlyStats();

    logSection('TokenUsage 月度聚合');
    console.log(`  calls=${stats.calls}, totalCost=$${stats.totalCost.toFixed(4)}`);

    expect(stats.calls).toBe(2);
    expect(stats.totalCost).toBeCloseTo(0.03);
    expect(await service.isOverBudget(0.02)).toBe(true);
  });

  it('能按 nodeName 和 agentName 聚合成本', async () => {
    const service = new TokenUsageService(
      createMockPrisma([
        { nodeName: 'security_expert', agentName: 'security_expert', inputTokens: 3000, estimatedCostUsd: 0.03 },
        { nodeName: 'functional_expert', agentName: 'functional_expert', inputTokens: 1000, estimatedCostUsd: 0.01 },
        { nodeName: 'security_expert', agentName: 'security_expert', inputTokens: 2000, estimatedCostUsd: 0.02 },
      ]),
    );

    const byNode = await service.getStatsByNode();
    const byAgent = await service.getStatsByAgent();

    logSection('TokenUsage 节点/Agent 聚合');
    console.log(`  最贵节点: ${byNode[0].nodeName}, cost=$${byNode[0].totalCost}`);
    console.log(`  最贵Agent: ${byAgent[0].agentName}, cost=$${byAgent[0].totalCost}`);

    expect(byNode[0].nodeName).toBe('security_expert');
    expect(byNode[0].calls).toBe(2);
    expect(byAgent[0].agentName).toBe('security_expert');
  });

  it('recordUsage 抛错时不向上抛出', async () => {
    const service = new TokenUsageService({
      token_usages: {
        create: mock(async () => {
          throw new Error('db down');
        }),
      },
    } as any);

    await expect(
      service.recordUsage({
        graphName: 'requirement-analysis',
        nodeName: 'summary',
        agentName: 'summary_agent',
        modelName: 'gpt-4o',
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0.001,
      }),
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// 10.8.3 withTokenUsage 包装器
// ============================================================================

describe('10.8.4 withTokenUsage - usage 自动采集包装器', () => {
  it('mock response 带 usage metadata 时，优先使用真实 usage', async () => {
    const records: any[] = [];
    const usageService: any = {
      recordUsage: mock(async (record: any) => records.push(record)),
    };

    const result = await withTokenUsage(
      {
        graphName: 'requirement-analysis',
        nodeName: 'supervisor',
        agentName: 'supervisor',
        modelName: 'gpt-4o',
        modelConfigId: 'demo-gpt-4o',
      },
      usageService,
      async () => ({
        content: 'ok',
        response_metadata: {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
            prompt_tokens_details: { cached_tokens: 100 },
          },
        },
      }),
    );

    logSection('withTokenUsage 真实 usage');
    console.log(`  input=${records[0].inputTokens}, output=${records[0].outputTokens}, cached=${records[0].cachedInputTokens}`);

    expect((result as any).content).toBe('ok');
    expect(records[0].inputTokens).toBe(1000);
    expect(records[0].outputTokens).toBe(200);
    expect(records[0].cachedInputTokens).toBe(100);
    expect(records[0].isEstimated).toBe(false);
  });

  it('mock response 不带 metadata 时，走估算并设置 isEstimated=true', async () => {
    const records: any[] = [];
    const usageService: any = {
      recordUsage: mock(async (record: any) => records.push(record)),
    };

    await withTokenUsage(
      {
        graphName: 'requirement-analysis',
        nodeName: 'summary',
        agentName: 'summary_agent',
        modelName: 'gpt-4o-mini',
      },
      usageService,
      async () => new AIMessage('这是一个摘要结果'),
    );

    logSection('withTokenUsage fallback 估算');
    console.log(`  input=${records[0].inputTokens}, output=${records[0].outputTokens}, estimated=${records[0].isEstimated}`);

    expect(records[0].isEstimated).toBe(true);
    expect(records[0].outputTokens).toBeGreaterThan(0);
    expect(records[0].inputTokens).toBe(records[0].outputTokens * 5);
    expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('recordUsage 失败时仍返回模型响应', async () => {
    const usageService: any = {
      recordUsage: mock(async () => {
        throw new Error('db write failed');
      }),
    };

    const result = await withTokenUsage(
      {
        graphName: 'requirement-analysis',
        nodeName: 'risk',
        agentName: 'risk_agent',
        modelName: 'gpt-4o-mini',
      },
      usageService,
      async () => new AIMessage('风险分析完成'),
    );

    expect(result).toBeInstanceOf(AIMessage);
    expect(result.content).toContain('风险分析完成');
  });

  it('usageService 为 null 时跳过记录并返回结果', async () => {
    const result = await withTokenUsage(
      {
        graphName: 'requirement-analysis',
        nodeName: 'compressor',
        agentName: 'compressor',
        modelName: 'deepseek-chat',
      },
      null,
      async () => 'compressed summary',
    );

    expect(result).toBe('compressed summary');
  });
});

// ============================================================================
// 10.9.1 AgentModelSet
// ============================================================================

describe('10.7.2 AgentModelSet - 默认模型配置', () => {
  it('默认按角色返回不同 modelConfigId', () => {
    const supervisor = resolveModelForAgent({ agentName: 'supervisor' });
    const functional = resolveModelForAgent({ agentName: 'functional_expert' });
    const compressor = resolveModelForAgent({ agentName: 'compressor' });

    logSection('默认模型分级');
    console.log(`  supervisor: ${supervisor.selectedModelConfigId}`);
    console.log(`  functional: ${functional.selectedModelConfigId}`);
    console.log(`  compressor: ${compressor.selectedModelConfigId}`);

    expect(supervisor.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(functional.selectedModelConfigId).toBe('demo-gpt-4o-mini');
    expect(compressor.selectedModelConfigId).toBe('demo-deepseek-chat');
  });

  it('supervisor/security/compliance/summary/critic 默认强模型', () => {
    const agents: AgentName[] = ['supervisor', 'security_expert', 'compliance_expert', 'summary_agent', 'critic'];
    for (const agent of agents) {
      const result = resolveModelForAgent({ agentName: agent });
      expect(result.selectedModelConfigId).toBe('demo-gpt-4o');
    }
  });

  it('简单需求只启用 functional 可选择低成本模型', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      requirementComplexity: 'low',
    });

    logSection('低复杂度降级');
    console.log(`  functional_expert (low complexity): ${result.selectedModelConfigId}`);
    console.log(`  overrideReason: ${result.overrideReason}`);

    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
    expect(result.overrideReason).toContain('low_complexity');
  });
});

// ============================================================================
// 10.9.2 运行时模型覆盖
// ============================================================================

describe('10.7.3 运行时模型覆盖 - resolveModelForAgent', () => {
  it('预算 80%-100% 时低风险 functional_expert 返回 downgrade', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 85 },
    });

    logSection('预算紧张降级');
    console.log(`  functional (85%): ${result.selectedModelConfigId}, reason: ${result.overrideReason}`);

    expect(result.overrideReason).toContain('budget_tight');
  });

  it('安全/合规高风险场景不 downgrade', () => {
    const security = resolveModelForAgent({
      agentName: 'security_expert',
      budgetStatus: { usedPercent: 90 },
    });

    logSection('高风险 Agent 不降级');
    console.log(`  security (90%): ${security.selectedModelConfigId}, reason: ${security.overrideReason}`);

    expect(security.selectedModelConfigId).toBe('demo-gpt-4o');
    expect(security.overrideReason).toBeNull();
  });

  it('超预算时返回 reject reason', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 105 },
    });

    expect(result.overrideReason).toContain('budget_exceeded');
  });

  it('compressor 在超预算时仍可执行', () => {
    const result = resolveModelForAgent({
      agentName: 'compressor',
      budgetStatus: { usedPercent: 110 },
    });

    expect(result.overrideReason).toBeNull();
    expect(result.selectedModelConfigId).toBe('demo-deepseek-chat');
  });

  it('每次 override 都有 overrideReason', () => {
    const result = resolveModelForAgent({
      agentName: 'functional_expert',
      budgetStatus: { usedPercent: 85 },
    });
    expect(result.overrideReason).not.toBeNull();
    expect(typeof result.overrideReason).toBe('string');
  });
});

// ============================================================================
// 10.9.3 预算动作选择
// ============================================================================

describe('10.9.1 预算动作选择 - resolveBudgetAction', () => {
  it('低预算使用率返回 allow', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 50,
      agentName: 'functional_expert',
    });
    expect(result.action).toBe('allow');
  });

  it('预算接近上限时 functional 可 downgrade', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 85,
      agentName: 'functional_expert',
    });

    logSection('预算策略');
    console.log(`  functional (85%): ${result.action} - ${result.reason}`);

    expect(result.action).toBe('downgrade');
  });

  it('安全合规高风险场景不 downgrade', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 90,
      agentName: 'security_expert',
      requirementRiskLevel: 'high',
    });
    expect(result.action).toBe('allow');
  });

  it('超预算时主分析图 reject', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 105,
      agentName: 'functional_expert',
    });
    expect(result.action).toBe('reject');
  });

  it('compressor 在超预算时仍可 allow', () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: 'compressor',
    });

    logSection('compressor 超预算豁免');
    console.log(`  compressor (110%): ${result.action} - ${result.reason}`);

    expect(result.action).toBe('allow');
  });
});
