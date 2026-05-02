/**
 * requirement-analysis-graph.ts
 *
 * 使用 LangGraph 实现需求分析流程。
 * 将原有的 Promise 链式调用迁移到 StateGraph，支持并行执行和状态管理。
 * 支持意图分类和多路由：分析、查询、聊天。
 */
import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import {
  createExtractAgent,
  createClarifyAgent,
  createRiskAgent,
  createSummaryAgent,
} from '../agents/sub-agents';
import { createAnalysisSupervisorSubGraph } from './experts';

/**
 * 意图分类的 Zod Schema
 */
const IntentSchema = z.object({
  intent: z.enum(['analyze', 'query', 'chat']).describe(
    '用户意图：analyze=需求分析，query=查询需求状态，chat=闲聊对话'
  ),
  reasoning: z.string().describe('判断该意图的理由（1-2句话）'),
});

/**
 * 定义需求分析的状态类型
 * 使用 Annotation.Root 自动推断类型
 */
export const RequirementAnalysisState = Annotation.Root({
  // 复用 MessagesAnnotation 处理消息历史
  ...MessagesAnnotation.spec,
  
  // 用户原始输入
  input: Annotation<string>,
  
  // RAG 检索上下文
  retrievedContext: Annotation<string>,
  
  // 用户意图（带默认值）
  intent: Annotation<'analyze' | 'query' | 'chat'>({
    reducer: (_, newValue) => newValue,
    default: () => 'analyze' as const,
  }),
  
  // extract 节点输出：结构化的需求字段
  extracted: Annotation<Record<string, unknown>>,
  
  // clarify 节点输出：澄清判断结果
  clarified: Annotation<{
    needsClarification: boolean;
    questions: string[];
  }>,
  
  // analysis 节点输出：多维度分析结果（Markdown）
  analysisResult: Annotation<string>,
  
  // risk 节点输出：风险评估结果（Markdown）
  riskResult: Annotation<string>,
  
  // summary 节点输出：最终综合报告（Markdown）
  summary: Annotation<string>,
  
  // 查询响应
  queryResponse: Annotation<string>,
  
  // 聊天响应
  chatResponse: Annotation<string>,
  
  // 工具循环计数（用于 ReAct 子图的硬上限控制）
  toolLoopCount: Annotation<number>({
    reducer: (_, newValue) => newValue,
    default: () => 0,
  }),
  
  // Multi-Agent 专家子图字段（9.2）
  functionalAnalysis: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),
  performanceAnalysis: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),
  securityAnalysis: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),
  complianceAnalysis: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),
  activeExperts: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Handoff 字段（9.4）
  handoffReason: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),

  // Critic-Refine 子图专用字段
  critique: Annotation<string>({
    reducer: (_, newValue) => newValue,
    default: () => '',
  }),
  
  reviseCount: Annotation<number>({
    reducer: (_, newValue) => newValue,
    default: () => 0,
  }),
  
  summaryHistory: Annotation<string[]>({
    reducer: (old, newValue) => [...old, ...newValue],
    default: () => [],
  }),
});

/**
 * 节点 1：需求提取
 * 从用户输入中提取结构化的需求信息
 */
async function extractNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  
  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:133',message:'extractNode 开始',data:{input:state.input.substring(0,50)},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  const extractAgent = createExtractAgent(model);
  
  const extractRaw = await extractAgent.invoke({ input: state.input });
  
  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:143',message:'extractNode AI 完成',data:{rawLength:extractRaw.length},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  // 清洗 LLM 输出：移除 markdown 代码块和文本前缀
  let cleanExtract = extractRaw.trim();
  
  // 1. 尝试提取 markdown 代码块中的内容
  const fenceMatch = cleanExtract.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleanExtract = fenceMatch[1].trim();
  }
  
  // 2. 移除可能的文本前缀（如 "analyze{...}" 中的 "analyze"）
  // 查找第一个 { 或 [ 的位置
  const jsonStart = Math.min(
    cleanExtract.indexOf('{') !== -1 ? cleanExtract.indexOf('{') : Infinity,
    cleanExtract.indexOf('[') !== -1 ? cleanExtract.indexOf('[') : Infinity,
  );
  
  if (jsonStart !== Infinity && jsonStart > 0) {
    cleanExtract = cleanExtract.substring(jsonStart);
  }
  
  // 尝试解析 JSON
  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(cleanExtract);
  } catch (error) {
    console.error('[extractNode] JSON 解析失败:', error, '\n原始内容:', extractRaw);
    extracted = {
      isComplete: false,
      missingFields: ['JSON 解析失败，请重试'],
    };
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:163',message:'extractNode 完成',data:{hasExtracted:!!extracted},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  return { extracted };
}

/**
 * 节点 2：澄清判断
 * 判断是否需要向用户提问以获取更多信息
 */
async function clarifyNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  const clarifyAgent = createClarifyAgent(model);
  
  const extractResultStr = JSON.stringify(state.extracted);
  const clarifyRaw = await clarifyAgent.invoke({
    extractResult: extractResultStr,
    input: state.input,
  });
  
  // 清洗 LLM 输出：移除 markdown 代码块和文本前缀
  let cleanClarify = clarifyRaw.trim();
  
  // 1. 尝试提取 markdown 代码块中的内容
  const fenceMatch = cleanClarify.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleanClarify = fenceMatch[1].trim();
  }
  
  // 2. 移除可能的文本前缀
  const jsonStart = Math.min(
    cleanClarify.indexOf('{') !== -1 ? cleanClarify.indexOf('{') : Infinity,
    cleanClarify.indexOf('[') !== -1 ? cleanClarify.indexOf('[') : Infinity,
  );
  
  if (jsonStart !== Infinity && jsonStart > 0) {
    cleanClarify = cleanClarify.substring(jsonStart);
  }
  
  // 尝试解析 JSON
  let clarified: { needsClarification: boolean; questions: string[] };
  try {
    clarified = JSON.parse(cleanClarify);
  } catch (error) {
    console.error('[clarifyNode] JSON 解析失败:', error, '\n原始内容:', clarifyRaw);
    clarified = { needsClarification: false, questions: [] };
  }
  
  return { clarified };
}

/**
 * 创建 Critic-Refine 子图：用于综合报告生成与迭代优化
 * 支持 actor → critic → refine 的闭环修订流程
 */
function createSummarySubGraph(model: BaseChatModel) {
  /**
   * Actor 节点：生成初版报告
   */
  async function actorNode(
    state: typeof RequirementAnalysisState.State
  ): Promise<Partial<typeof RequirementAnalysisState.State>> {
    const response = await model.invoke([
      {
        role: 'system',
        content: `你是资深需求分析师。根据分析和风险评估生成综合报告。

**报告必需章节（标题必须包含关键词）**：
1. ## 需求摘要 - 200-300 字概述核心功能、目标用户、业务价值
2. ## 功能分解 - 主要模块和子功能（直接复用 analysisResult）
3. ## 冲突分析 - 与现有需求的冲突点 + 解决方案（必须包含解决方案，不能只描述问题）
4. ## 技术复杂度 - 评估（低/中/高）+ 详细理由和技术细节
5. ## 开发排期 - 各阶段时长 + 依赖项（必须标明"XX 依赖 YY 完成"）

**格式要求**：
- 必须使用二级标题 ## 且标题必须包含"摘要"、"功能"、"冲突"、"复杂度"、"排期"等关键词
- 每个章节内容要详细充实，不少于 100 字
- 关键信息用粗体或列表
- 排期必须标明依赖关系
- 冲突分析必须包含解决方案
- 整体报告长度不少于 600 字`,
      },
      {
        role: 'user',
        content: `原始需求：${state.input}

提取结果：${JSON.stringify(state.extracted)}

分析结果：${state.analysisResult}

风险评估：${state.riskResult}

请生成完整的综合报告，确保包含所有必需章节且标题格式正确。`,
      },
    ]);
    
    console.log('[Critic子图] actorNode 完成');
    return { summary: response.content as string };
  }

  /**
   * Critic 节点：评审检查
   */
  async function criticNode(
    state: typeof RequirementAnalysisState.State
  ): Promise<Partial<typeof RequirementAnalysisState.State>> {
    const response = await model.invoke([
      {
        role: 'system',
        content: `你是资深需求评审专家。按以下标准检查综合报告：

**评审标准**（必须全部满足）：
1. 章节完整性：必须包含"摘要"、"功能"、"冲突"、"复杂度"、"排期"等关键词的标题
2. 内容长度：报告总长度不少于 500 字
3. 排期依赖项：排期章节必须标明各阶段的依赖关系（如"前端开发依赖后端 API 完成"）
4. 冲突解决方案：如果存在冲突，必须给出具体解决方案，不能只描述问题
5. 逻辑一致性：各章节之间不能有明显矛盾（如摘要说低复杂度，但技术分析提到大规模重构）

**输出纯 JSON 对象**（不要包含 markdown 代码块）：
{
  "pass": true,
  "critique": ""
}

**输出要求**：
- 如果全部满足，返回 pass=true, critique=""
- 如果任一不满足，返回 pass=false，并给出最关键的 1-2 条修改意见
- 修改意见要具体，指出缺少什么或哪里矛盾
- 避免主观性评价（如"语言不够优美"）

**重要**：
- 章节标题必须包含"摘要"、"复杂度"、"排期"等完整关键词
- 不要过度严格，只检查核心要素，否则会导致无限循环`,
      },
      {
        role: 'user',
        content: `待评审报告：

${state.summary}

请按标准评审。`,
      },
    ]);
    
    // 清洗 JSON 输出（类似 clarifyNode 的处理方式）
    let cleanJson = (response.content as string).trim();
    
    // 尝试提取 markdown 代码块中的内容
    const fenceMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      cleanJson = fenceMatch[1].trim();
    }
    
    // 移除可能的文本前缀，查找 JSON 开始位置
    const jsonStart = Math.min(
      cleanJson.indexOf('{') !== -1 ? cleanJson.indexOf('{') : Infinity,
      cleanJson.indexOf('[') !== -1 ? cleanJson.indexOf('[') : Infinity,
    );
    
    if (jsonStart !== Infinity && jsonStart > 0) {
      cleanJson = cleanJson.substring(jsonStart);
    }
    
    // 尝试解析 JSON
    let result: { pass: boolean; critique: string };
    try {
      result = JSON.parse(cleanJson);
    } catch (error) {
      console.error('[Critic子图] criticNode JSON 解析失败:', error, '\n原始内容:', response.content);
      // 降级：假设通过评审
      result = { pass: true, critique: '' };
    }
    
    console.log(`[Critic子图] criticNode: pass=${result.pass}, critique=${result.critique}`);
    
    return {
      critique: result.pass ? '' : result.critique
    };
  }

  /**
   * Refine 节点：修订改进
   */
  async function refineNode(
    state: typeof RequirementAnalysisState.State
  ): Promise<Partial<typeof RequirementAnalysisState.State>> {
    const response = await model.invoke([
      {
        role: 'system',
        content: `你是需求分析师。根据评审意见修订报告。

**修订原则**：
1. 只修改被指出的问题部分
2. 未被批评的章节保持不变
3. 补充缺失的章节或内容
4. 修正逻辑矛盾

**禁止行为**：
- 不要重新生成整个报告
- 不要删除正确的内容
- 不要改变原有的结构和风格`,
      },
      {
        role: 'user',
        content: `原报告：
${state.summary}

评审意见：
${state.critique}

请根据评审意见修订报告，只改有问题的地方。`,
      },
    ]);
    
    console.log(`[Critic子图] refineNode: reviseCount=${state.reviseCount + 1}`);
    
    return {
      summary: response.content as string,
      reviseCount: state.reviseCount + 1,
    };
  }

  /**
   * 条件边函数：判断是否需要修订
   */
  function shouldRefine(state: typeof RequirementAnalysisState.State): string {
    // 优先级 1：硬上限检查（防止无限循环）
    if (state.reviseCount >= 2) {
      console.log('[Critic子图] 达到修订上限，强制终止');
      return END;
    }
    
    // 优先级 2：检查是否通过评审
    if (!state.critique || state.critique.trim() === '') {
      console.log('[Critic子图] 通过评审，完成');
      return END;
    }
    
    // 优先级 3：需要修订
    console.log('[Critic子图] 未通过评审，进入 refine');
    return 'refine';
  }

  // 构建并返回子图
  return new StateGraph(RequirementAnalysisState)
    .addNode('actor', actorNode)
    .addNode('critic', criticNode)
    .addNode('refine', refineNode)
    .addEdge(START, 'actor')        // 开始 → 生成初版
    .addEdge('actor', 'critic')     // 初版 → 评审
    .addConditionalEdges('critic', shouldRefine, {
      [END]: END,                   // 通过或达上限 → 结束
      'refine': 'refine',           // 未通过 → 修订
    })
    .addEdge('refine', 'critic')    // 修订完 → 重新评审（回边）
    .compile();
}

// ---------------------------------------------------------------------------
// 9.4 Handoff：Triage Node —— 主图入口（已替换原 classifierNode）
// ---------------------------------------------------------------------------

/**
 * 分诊 Schema（Handoff 模式）：
 * - answer            ：简单问题（闲聊、问候、澄清）由 triage 直接回答
 * - handoff_to_query  ：需求状态查询、信息检索 → 交给 queryHandler
 * - handoff_to_analysis：需要完整性/冲突/复杂度分析 → 进入完整分析链
 */
export const triageSchema = z.object({
  action: z.enum(['answer', 'handoff_to_query', 'handoff_to_analysis']),
  response: z.string().describe('当 action=answer 时直接回复用户的内容'),
  reason: z.string().nullable().describe('交接理由，无理由时为 null'),
});

/**
 * 分诊节点（替代原 classifierNode）
 * 简单问题直接回答（chat 短路 END），复杂问题交接给专家。
 */
export async function triageNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  const structured = model.withStructuredOutput(triageSchema);
  const result = await structured.invoke([
    {
      role: 'system',
      content: `你是需求分诊 Agent。判断用户意图，规则：
- 闲聊、问候、术语解释 → action: answer（直接在 response 里回答用户）
- 查询已有需求的状态/信息（含 REQ-编号） → action: handoff_to_query
- 需要完整性/冲突/复杂度分析、需求评估 → action: handoff_to_analysis
转交时给出简要理由。`,
    },
    ...state.messages,
    { role: 'user', content: state.input },
  ]);

  if (result.action === 'answer') {
    return {
      messages: [new AIMessage(result.response)],
      intent: 'chat',
      chatResponse: result.response,
      summary: result.response,
      handoffReason: '',
    };
  }

  if (result.action === 'handoff_to_query') {
    return {
      intent: 'query',
      handoffReason: result.reason || '',
    };
  }

  return {
    intent: 'analyze',
    handoffReason: result.reason || '',
  };
}

/**
 * 节点 4：风险评估
 * 识别需求中的模糊性、范围、技术、业务等风险
 */
async function riskNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  const riskAgent = createRiskAgent(model);
  
  const extractResultStr = JSON.stringify(state.extracted);
  const riskResult = await riskAgent.invoke({
    extractResult: extractResultStr,
    input: state.input,
  });
  
  return { riskResult };
}

/**
 * 节点 5：综合报告
 * 基于所有分析结果生成最终的需求分析报告
 */
async function summaryNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  const summaryAgent = createSummaryAgent(model);
  
  const extractResultStr = JSON.stringify(state.extracted);
  const summary = await summaryAgent.invoke({
    input: state.input,
    extractResult: extractResultStr,
    analysisResult: state.analysisResult,
    riskResult: state.riskResult,
    retrievedContext: state.retrievedContext || '无相关参考文档',
  });
  
  return { summary };
}

/**
 * 节点：查询处理器
 * 处理需求查询请求
 */
async function queryHandlerNode(
  state: typeof RequirementAnalysisState.State,
  config: { model: BaseChatModel },
): Promise<Partial<typeof RequirementAnalysisState.State>> {
  const { model } = config;
  
  const response = await model.invoke([
    {
      role: 'system',
      content: '你是一个需求查询助手。根据用户的查询请求，提供需求的状态、进度等信息。',
    },
    {
      role: 'user',
      content: state.input,
    },
  ]);
  
  return { 
    queryResponse: response.content as string,
    summary: response.content as string, // 兼容旧接口
  };
}

/**
 * 路由函数：根据 triage 决定下一个节点
 * - analyze → 完整分析链
 * - query   → queryHandler
 * - chat    → END（triage 已直接回答，短路结束）
 */
function routeByIntent(
  state: typeof RequirementAnalysisState.State,
): string {
  const intent = state.intent || 'analyze';

  switch (intent) {
    case 'query':
      return 'queryHandler';
    case 'chat':
      return END;
    case 'analyze':
    default:
      return 'extractStep';
  }
}

/**
 * 路由函数：根据澄清结果决定是否继续分析
 * 如果需要澄清，则直接结束；否则继续执行分析和风险评估
 */
function routeAfterClarify(
  state: typeof RequirementAnalysisState.State,
): string | string[] {
  // 检查是否需要澄清
  if (state.clarified?.needsClarification) {
    // 需要澄清，直接结束流程
    return END;
  }
  
  // 不需要澄清，继续并行执行分析和风险评估
  return ['analysisStep', 'riskStep'];
}

/**
 * 创建需求分析图（支持意图路由）
 *
 * @param model LangChain 模型实例
 * @param options.checkpointer    可选 checkpointer，传入后图状态会持久化到该 saver
 * @param options.interruptBefore 可选中断节点列表，进入该节点前暂停（HITL 用）
 * @returns 编译后的 StateGraph
 */
export function createAnalysisGraph(
  model: BaseChatModel,
  options?: {
    checkpointer?: BaseCheckpointSaver;
    interruptBefore?: string[];
  },
) {
  // 9.2: Supervisor + 4 专家并行子图
  const analysisSubGraph = createAnalysisSupervisorSubGraph(model);
  
  // 创建 Critic-Refine 子图用于综合报告生成（8.6）
  const summarySubGraph = createSummarySubGraph(model);
  
  const graph = new StateGraph(RequirementAnalysisState)
    // 9.4: Triage 替代原 classifier，简单问题在 triage 内直接回答
    .addNode('triage', (state) => triageNode(state, { model }))

    // 添加原有的五个分析节点（注意：节点名不能与状态字段名冲突）
    .addNode('extractStep', (state) => extractNode(state, { model }))
    .addNode('clarifyStep', (state) => clarifyNode(state, { model }))
    // ⭐ 关键：将 analysisStep 替换为 ReAct 子图（8.5）
    .addNode('analysisStep', analysisSubGraph)
    .addNode('riskStep', (state) => riskNode(state, { model }))
    // ⭐ 关键：将 summaryStep 替换为 Critic-Refine 子图（8.6）
    .addNode('summaryStep', summarySubGraph)

    // 查询交给 queryHandler；闲聊由 triage 直接回答（路由到 END）
    .addNode('queryHandler', (state) => queryHandlerNode(state, { model }))

    .addEdge(START, 'triage')

    // 条件边：triage 根据 intent 路由（chat 已被 triage 处理，直接 END）
    .addConditionalEdges('triage', routeByIntent)

    // 保留完整的分析链
    .addEdge('extractStep', 'clarifyStep')

    // 条件边：clarify 完成后根据是否需要澄清决定路由
    .addConditionalEdges('clarifyStep', routeAfterClarify)

    // 汇聚：analysis 和 risk 都完成后才执行 summary
    .addEdge('analysisStep', 'summaryStep')
    .addEdge('riskStep', 'summaryStep')
    
    .addEdge('summaryStep', END)

    // 查询直接结束（chat 已由 triage 直接回答并短路 END）
    .addEdge('queryHandler', END);

  return graph.compile({
    checkpointer: options?.checkpointer,
    interruptBefore: options?.interruptBefore as any,
  });
}

/**
 * 运行需求分析图的输入类型
 */
export interface RunAnalysisGraphInput {
  input: string;
  retrievedContext: string;
  model: BaseChatModel;
}

/**
 * 运行需求分析图的输出类型
 */
export interface RunAnalysisGraphOutput {
  intent?: 'analyze' | 'query' | 'chat';
  summary: string;
  extracted?: Record<string, unknown>;
  clarified?: { needsClarification: boolean; questions: string[] };
  analysisResult?: string;
  riskResult?: string;
  queryResponse?: string;
  chatResponse?: string;
  
  // Multi-Agent 相关字段（9.2）
  activeExperts?: string[];
  functionalAnalysis?: string;
  performanceAnalysis?: string;
  securityAnalysis?: string;
  complianceAnalysis?: string;

  // Critic-Refine 相关字段（8.6）
  critique?: string;
  reviseCount?: number;
  summaryHistory?: string[];
  
  steps: Record<string, string>;
}

/**
 * 运行需求分析图
 * @param input 输入参数
 * @returns 包含 intent、summary 和中间步骤的结果
 */
export async function runAnalysisGraph(
  input: RunAnalysisGraphInput,
): Promise<RunAnalysisGraphOutput> {
  const { input: userInput, retrievedContext, model } = input;
  
  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:397',message:'runAnalysisGraph 开始',data:{input:userInput.substring(0,100)},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  // 创建图实例
  const graph = createAnalysisGraph(model);
  
  // 执行图
  const result = await graph.invoke({
    input: userInput,
    retrievedContext,
    messages: [],
  });

  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:411',message:'graph.invoke 完成',data:{intent:result.intent,hasSummary:!!result.summary,hasQueryResponse:!!result.queryResponse,hasChatResponse:!!result.chatResponse},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  // 构建步骤记录
  const steps: Record<string, string> = {
    intent: result.intent || 'analyze',
  };
  
  // 根据意图添加相应步骤
  if (result.intent === 'analyze') {
    steps.extract = JSON.stringify(result.extracted);
    steps.clarify = JSON.stringify(result.clarified);
    steps.analysis = result.analysisResult || '';
    steps.risk = result.riskResult || '';
    steps.summary = result.summary || '';
  } else if (result.intent === 'query') {
    steps.queryResponse = result.queryResponse || '';
  } else if (result.intent === 'chat') {
    steps.chatResponse = result.chatResponse || '';
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7439/ingest/d2836ca5-d253-4abc-ae4c-b65a3a5711c8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28b230'},body:JSON.stringify({sessionId:'28b230',location:'requirement-analysis-graph.ts:436',message:'runAnalysisGraph 完成',data:{intent:result.intent,summaryLength:(result.summary||result.queryResponse||result.chatResponse||'').length},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  // 返回结果
  return {
    intent: result.intent,
    summary: result.summary || result.queryResponse || result.chatResponse || '',
    extracted: result.extracted,
    clarified: result.clarified,
    analysisResult: result.analysisResult,
    riskResult: result.riskResult,
    queryResponse: result.queryResponse,
    chatResponse: result.chatResponse,
    
    // Multi-Agent 相关字段（9.2）
    activeExperts: result.activeExperts,
    functionalAnalysis: result.functionalAnalysis,
    performanceAnalysis: result.performanceAnalysis,
    securityAnalysis: result.securityAnalysis,
    complianceAnalysis: result.complianceAnalysis,

    // Critic-Refine 相关字段（8.6）
    critique: result.critique,
    reviseCount: result.reviseCount,
    summaryHistory: result.summaryHistory,
    
    steps,
  };
}

/**
 * 流式事件类型
 */
export type GraphStreamEvent = 
  | { type: 'node_start'; node: string }
  | { type: 'token'; content: string; node: string }
  | { type: 'node_end'; node: string; output: any }
  | { type: 'log'; level: 'info' | 'debug' | 'error'; message: string; data?: Record<string, any> }
  | { type: 'complete'; result: RunAnalysisGraphOutput };

/**
 * 流式运行需求分析图
 * 使用 LangGraph stream API 结合 streamEvents 实现真正的 token 级流式输出
 * 
 * @param input 输入参数
 * @returns AsyncGenerator 生成流式事件
 */
export async function* streamAnalysisGraph(
  input: RunAnalysisGraphInput,
): AsyncGenerator<GraphStreamEvent> {
  const { input: userInput, retrievedContext, model } = input;
  
  // Yield 日志事件
  yield {
    type: 'log',
    level: 'info',
    message: 'streamAnalysisGraph 开始',
    data: { input: userInput.substring(0, 100) },
  };
  
  // 创建图实例
  const graph = createAnalysisGraph(model);
  
  // 用于累积状态和步骤
  let finalState: typeof RequirementAnalysisState.State | null = null;
  const steps: Record<string, string> = {};
  const visitedNodes = new Set<string>();
  
  try {
    // 使用 stream 结合 streamEvents 获取完整的执行信息
    // 方案：并行运行两个流，一个获取状态更新，一个获取 token
    const streamPromise = (async () => {
      const chunks: any[] = [];
      for await (const chunk of await graph.stream(
        {
          input: userInput,
          retrievedContext,
          messages: [],
        },
        { streamMode: 'updates' }
      )) {
        chunks.push(chunk);
      }
      return chunks;
    })();
    
    // 使用 streamEvents 获取 token 级别的输出
    let currentNode: string | null = null;
    const eventStream = graph.streamEvents(
      {
        input: userInput,
        retrievedContext,
        messages: [],
      },
      { version: 'v2' }
    );
    
    for await (const event of eventStream) {
      // 监听节点开始事件
      if (event.event === 'on_chain_start') {
        const nodeName = event.name;
        
        // 过滤掉内部节点和非业务节点
        const internalNodes = [
          'RunnableSequence',
          'StateGraph',
          'LangGraph',
          'RunnableLambda',
          '__start__',
          '__end__',
        ];
        // 9.2 专家子图内部 ReAct 循环节点（同名碰撞且属于实现细节，不暴露）
        const reactInternalNodes = ['agent', 'tools', 'finalize'];
        const isInternalNode =
          internalNodes.some((internal) => nodeName?.includes(internal)) ||
          reactInternalNodes.includes(nodeName);
        
        if (nodeName && !isInternalNode && !visitedNodes.has(nodeName)) {
          visitedNodes.add(nodeName);
          currentNode = nodeName;
          yield {
            type: 'node_start',
            node: nodeName,
          };
          
          yield {
            type: 'log',
            level: 'debug',
            message: `节点开始: ${nodeName}`,
          };
        }
      }
      
      // 监听 LLM token 流式输出
      // 只流式发送 markdown 内容节点的输出，不发送 JSON 节点（extract、clarify）的输出
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk;
        if (chunk?.content && typeof chunk.content === 'string' && currentNode) {
          // 过滤掉返回 JSON 的节点
          // triage 用 withStructuredOutput 输出 JSON，不应流式 token
          const jsonNodes = ['extractStep', 'clarifyStep', 'triage'];
          const shouldStreamToken = !jsonNodes.includes(currentNode);
          
          if (shouldStreamToken) {
            yield {
              type: 'token',
              content: chunk.content,
              node: currentNode,
            };
          }
        }
      }
      
      // 监听节点完成事件
      if (event.event === 'on_chain_end') {
        const nodeName = event.name;
        
        // 只处理已记录的业务节点
        if (nodeName && visitedNodes.has(nodeName)) {
          const output = event.data?.output;
          
          yield {
            type: 'node_end',
            node: nodeName,
            output,
          };
          
          yield {
            type: 'log',
            level: 'debug',
            message: `节点完成: ${nodeName}`,
            data: { hasOutput: !!output },
          };
        }
      }
      
      // 监听整个 graph 完成（获取最终状态）
      if (event.event === 'on_chain_end' && event.name && event.name.includes('StateGraph')) {
        finalState = event.data?.output;
      }
    }
    
    // 等待 stream 完成以确保获取到最终状态
    await streamPromise;
    
    // 如果 finalState 还是 null，再次获取
    if (!finalState) {
      finalState = await graph.invoke({
        input: userInput,
        retrievedContext,
        messages: [],
      });
    }
    
    const result = finalState;
    
    yield {
      type: 'log',
      level: 'info',
      message: 'graph 执行完成',
      data: {
        intent: result.intent,
        hasSummary: !!result.summary,
        hasQueryResponse: !!result.queryResponse,
        hasChatResponse: !!result.chatResponse,
      },
    };
    
    // 构建步骤记录
    steps.intent = result.intent || 'analyze';
    
    // 检查是否需要澄清（短路逻辑）
    const needsClarification = result.clarified?.needsClarification === true;
    
    if (result.intent === 'analyze') {
      steps.extract = JSON.stringify(result.extracted);
      steps.clarify = JSON.stringify(result.clarified);
      
      // 只有在不需要澄清时才有后续步骤
      if (!needsClarification) {
        steps.analysis = result.analysisResult || '';
        steps.risk = result.riskResult || '';
        steps.summary = result.summary || '';
      }
    } else if (result.intent === 'query') {
      steps.queryResponse = result.queryResponse || '';
    } else if (result.intent === 'chat') {
      steps.chatResponse = result.chatResponse || '';
    }
    
    // 返回最终结果
    // 如果需要澄清，summary 应该包含澄清问题
    let summary = '';
    if (needsClarification && result.clarified?.questions && result.clarified.questions.length > 0) {
      // 格式化澄清问题 - 使用更友好的展示方式
      const questionList = result.clarified.questions
        .map((q, i) => `**${i + 1}.** ${q}`)
        .join('\n\n');
      
      summary = `## 📋 需要补充信息

为了更好地分析需求，还需要了解以下信息：

${questionList}

---

💡 **提示**：请补充上述信息后，我将继续为您生成完整的需求分析报告。`;
    } else {
      summary = result.summary || result.queryResponse || result.chatResponse || '';
    }
    
    const finalResult: RunAnalysisGraphOutput = {
      intent: result.intent,
      summary,
      extracted: result.extracted,
      clarified: result.clarified,
      analysisResult: result.analysisResult,
      riskResult: result.riskResult,
      queryResponse: result.queryResponse,
      chatResponse: result.chatResponse,
      steps,
    };
    
    yield {
      type: 'complete',
      result: finalResult,
    };
    
    yield {
      type: 'log',
      level: 'info',
      message: 'streamAnalysisGraph 完成',
      data: {
        intent: result.intent,
        summaryLength: (result.summary || result.queryResponse || result.chatResponse || '').length,
      },
    };
    
  } catch (error) {
    yield {
      type: 'log',
      level: 'error',
      message: 'streamAnalysisGraph 执行失败',
      data: { error: error instanceof Error ? error.message : String(error) },
    };
    
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 9.6.2 HITL：在 clarify 前中断 + resume
// ---------------------------------------------------------------------------

/**
 * HITL 共享 MemorySaver
 * 同一个 thread_id 的 checkpoint 在多次调用之间保持。
 * 生产环境替换为 PostgresSaver 即可（接口等价）。
 */
export const hitlCheckpointer = new MemorySaver();

/**
 * HITL 版本的需求分析图：在 clarifyStep 前中断
 * 典型用法：
 *   const snapshot = await startAnalysisGraphHITL(threadId, input, model);
 *   // 用户看 snapshot.values.extracted 后回答澄清问题
 *   const result = await resumeAnalysisGraphHITL(threadId, { clarified: { needsClarification: false, questions: [] } }, model);
 */
export function createAnalysisGraphHITL(model: BaseChatModel) {
  return createAnalysisGraph(model, {
    checkpointer: hitlCheckpointer,
    interruptBefore: ['clarifyStep'],
  });
}

/**
 * 启动一次 HITL 分析：跑到 clarifyStep 前暂停，返回 state 快照
 */
export async function startAnalysisGraphHITL(
  threadId: string,
  input: string,
  model: BaseChatModel,
) {
  const graph = createAnalysisGraphHITL(model);
  await graph.invoke(
    { input, retrievedContext: '', messages: [] },
    { configurable: { thread_id: threadId } },
  );
  return graph.getState({ configurable: { thread_id: threadId } });
}

/**
 * 用户提交澄清答案后，恢复执行直到完成
 * @param patch  写回 state 的字段（典型：{ clarified: { needsClarification: false, ... } }）
 */
export async function resumeAnalysisGraphHITL(
  threadId: string,
  patch: Partial<typeof RequirementAnalysisState.State>,
  model: BaseChatModel,
) {
  const graph = createAnalysisGraphHITL(model);
  await graph.updateState(
    { configurable: { thread_id: threadId } },
    patch,
  );
  return graph.invoke(null, { configurable: { thread_id: threadId } });
}
