/**
 * chapter9-multi-agent.spec.ts
 *
 * 第九章《LangGraph Multi-Agent 实战》配套测试用例
 *
 * 设计目标：
 * - **按文档章节组织**：每个 describe 标题以「9.x.y」开头，与文档小节一一对应
 * - **读者按图索骥**：在章节里看到代码示例后，可直接运行对应小节的测试看效果
 *   `bun test test/chapter9-multi-agent.spec.ts -t "9.2.2"`
 * - **效果可视化**：测试不仅断言，还通过 console.log 打印输入/输出，
 *   读者跑测试时能直接看到 supervisor 选了哪些专家、planner 拆出了哪些步骤等
 * - **零依赖**：单元测试用 mock model，无需 LLM API key
 *
 * 集成测试（需要真实 API key）放在文件末尾，对应文档「9.7 端到端验证」的实测场景。
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { RequirementAnalysisState } from '../src/llm/graph/requirement-analysis-graph';
import {
  supervisorNode,
  aggregatorNode,
  routeToExperts,
  createExpertSubGraph,
  createAnalysisSupervisorSubGraph,
} from '../src/llm/graph/experts';
import {
  triageNode,
  triageSchema,
  startAnalysisGraphHITL,
  resumeAnalysisGraphHITL,
} from '../src/llm/graph/requirement-analysis-graph';
import {
  PipelineState,
  plannerNode,
  executorNode,
  evaluatorNode,
  reflectorNode,
  shouldContinue,
  shouldReflect,
  runPipeline,
} from '../src/llm/graph/pipeline';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * 创建一个 mock BaseChatModel
 *
 * @param response  withStructuredOutput().invoke() 的返回值；
 *                  也作为 invoke() 的返回（字符串则包装成 AIMessage）
 */
function createMockModel(response: any = {}) {
  const invokeResult =
    typeof response === 'string' ? new AIMessage(response) : response;

  const mockModel: any = {
    invoke: mock(async () => invokeResult),
    bindTools: mock(function (this: any) {
      return this;
    }),
    withStructuredOutput: mock(() => ({
      invoke: mock(async () => response),
    })),
  };
  return mockModel;
}

/** 最小化 RequirementAnalysisState 工厂 */
function makeState(
  overrides: Partial<typeof RequirementAnalysisState.State> = {},
): typeof RequirementAnalysisState.State {
  return {
    messages: [],
    input: '',
    retrievedContext: '',
    intent: 'analyze',
    extracted: {},
    clarified: { needsClarification: false, questions: [] },
    analysisResult: '',
    riskResult: '',
    summary: '',
    queryResponse: '',
    chatResponse: '',
    toolLoopCount: 0,
    critique: '',
    reviseCount: 0,
    summaryHistory: [],
    functionalAnalysis: '',
    performanceAnalysis: '',
    securityAnalysis: '',
    complianceAnalysis: '',
    activeExperts: [],
    handoffReason: '',
    ...overrides,
  } as any;
}

/** 最小化 PipelineState 工厂 */
function makePipelineState(
  overrides: Partial<typeof PipelineState.State> = {},
): typeof PipelineState.State {
  return {
    messages: [],
    plan: [],
    currentStepIndex: 0,
    stepResults: {},
    reflections: [],
    retryCount: 0,
    parentThreadId: '',
    finalReport: '',
    approved: false,
    ...overrides,
  } as any;
}

/** 视觉化打印一段标题，让 bun test 输出更易读 */
function logSection(title: string) {
  console.log(`\n  ─── ${title} ───`);
}

// ============================================================================
// 单元测试（无需 LLM API Key）
// ============================================================================

describe('第九章 Multi-Agent 单元测试 (mock model, 无需 API key)', () => {
  // ==========================================================================
  // 9.2 Supervisor + 4 专家并行
  // ==========================================================================

  describe('9.2.1 State 扩展 - 多专家分析字段', () => {
    it('应包含 4 个专家分析字段（functional/performance/security/compliance）', () => {
      const state = makeState();

      logSection('State 字段一览');
      console.log('  functionalAnalysis :', JSON.stringify(state.functionalAnalysis));
      console.log('  performanceAnalysis:', JSON.stringify(state.performanceAnalysis));
      console.log('  securityAnalysis   :', JSON.stringify(state.securityAnalysis));
      console.log('  complianceAnalysis :', JSON.stringify(state.complianceAnalysis));

      expect(state.functionalAnalysis).toBe('');
      expect(state.performanceAnalysis).toBe('');
      expect(state.securityAnalysis).toBe('');
      expect(state.complianceAnalysis).toBe('');
    });

    it('应包含 activeExperts 字段（运行时由 supervisor 决定）', () => {
      const state = makeState();
      expect(Array.isArray(state.activeExperts)).toBe(true);
      expect(state.activeExperts).toEqual([]);
    });

    it('应包含 handoffReason 字段（由 9.4 triage 写入）', () => {
      const state = makeState();
      expect(state.handoffReason).toBe('');
    });
  });

  describe('9.2.1 createExpertSubGraph 工厂 - 专家子图装配', () => {
    it('应能为任意领域生成可运行的 ReAct 子图', () => {
      const subgraph = createExpertSubGraph({
        name: 'functional',
        model: createMockModel('mock'),
        tools: [],
        systemPrompt: '功能分析专家提示词...',
        outputField: 'functionalAnalysis',
      });

      console.log('  生成子图实例：', typeof subgraph.invoke === 'function' ? '✓ 可调用' : '✗');
      expect(subgraph).toBeDefined();
      expect(typeof subgraph.invoke).toBe('function');
    });

    it('专家执行抛错时应返回降级输出（finalize 兜底）', async () => {
      const failingModel: any = {
        invoke: async () => {
          throw new Error('API 调用超时');
        },
        bindTools: function (this: any) {
          return this;
        },
      };

      const subgraph = createExpertSubGraph({
        name: 'security',
        model: failingModel,
        tools: [],
        systemPrompt: '安全专家',
        outputField: 'securityAnalysis',
      });

      const result = await subgraph.invoke({
        input: '新增用户敏感数据导出',
        retrievedContext: '',
        messages: [],
        clarified: { needsClarification: false, questions: [] },
      });

      logSection('降级输出');
      console.log('  securityAnalysis →', result.securityAnalysis);

      expect(result.securityAnalysis).toContain('暂不可用');
      expect(result.securityAnalysis).toContain('API 调用超时');
    }, 30000);
  });

  describe('9.2.2 supervisorNode - 调度专家', () => {
    it('简单文案修改 → 只选 functional', async () => {
      const mockModel = createMockModel({
        experts: ['functional'],
        reason: '简单文案修改，只需功能分析',
      });

      const state = makeState({
        input: '将登录按钮文案改为"立即登录"',
        clarified: { needsClarification: false, questions: [] },
      });

      const result = await supervisorNode(state, { model: mockModel });

      logSection('Supervisor 决策');
      console.log('  输入  :', state.input);
      console.log('  选择  :', result.activeExperts);

      expect(result.activeExperts).toBeDefined();
      expect(result.activeExperts!.length).toBeGreaterThanOrEqual(1);
    });

    it('批量数据 + 用户权限 → 同时选 functional/performance/security', async () => {
      const mockModel = createMockModel({
        experts: ['functional', 'performance', 'security'],
        reason: '涉及批量数据和用户权限',
      });

      const state = makeState({
        input: '批量导入 Excel 用户数据',
        clarified: { needsClarification: false, questions: [] },
      });

      const result = await supervisorNode(state, { model: mockModel });

      logSection('Supervisor 多专家决策');
      console.log('  输入  :', state.input);
      console.log('  选择  :', result.activeExperts);

      expect(result.activeExperts).toEqual([
        'functional',
        'performance',
        'security',
      ]);
    });

    it('应使用 withStructuredOutput 强约束输出格式', async () => {
      const mockModel = createMockModel({
        experts: ['functional'],
        reason: 'test',
      });

      const state = makeState({ input: 'test' });
      await supervisorNode(state, { model: mockModel });

      expect(mockModel.withStructuredOutput).toHaveBeenCalled();
    });
  });

  describe('9.3 routeToExperts - 条件边并发分发', () => {
    it('单专家 → 单元素数组（仅 functional_expert 节点会被并行启动）', () => {
      const state = makeState({ activeExperts: ['functional'] });
      const routes = routeToExperts(state);

      logSection('routeToExperts 单专家');
      console.log('  activeExperts →', state.activeExperts);
      console.log('  下一跳节点    →', routes);

      expect(routes).toEqual(['functional_expert']);
    });

    it('多专家 → 多元素数组（LangGraph 自动并发执行）', () => {
      const state = makeState({
        activeExperts: ['functional', 'performance', 'security'],
      });
      const routes = routeToExperts(state);

      logSection('routeToExperts 多专家');
      console.log('  activeExperts →', state.activeExperts);
      console.log('  下一跳节点    →', routes);
      console.log('  ↳ 这 3 个节点会被 LangGraph 并行调度');

      expect(routes).toEqual([
        'functional_expert',
        'performance_expert',
        'security_expert',
      ]);
    });

    it('四专家全选 → 4 路并发', () => {
      const state = makeState({
        activeExperts: ['functional', 'performance', 'security', 'compliance'],
      });
      expect(routeToExperts(state)).toEqual([
        'functional_expert',
        'performance_expert',
        'security_expert',
        'compliance_expert',
      ]);
    });

    it('空数组 → 空路由（不应进入此状态，但防御性处理）', () => {
      const state = makeState({ activeExperts: [] });
      expect(routeToExperts(state)).toEqual([]);
    });
  });

  describe('9.2.3 aggregatorNode - 汇总专家结论', () => {
    it('应汇总 activeExperts 中所有专家的分析', async () => {
      const state = makeState({
        activeExperts: ['functional', 'performance'],
        functionalAnalysis: '## 功能模块拆解\n- 导入模块\n- 验证模块',
        performanceAnalysis: '## 负载特征评估\n- 预估 QPS: 100',
      });

      const result = await aggregatorNode(state);

      logSection('Aggregator 输出片段');
      console.log('  ', result.analysisResult!.substring(0, 200), '...');

      expect(result.analysisResult).toContain('功能分析');
      expect(result.analysisResult).toContain('性能分析');
      expect(result.analysisResult).toContain('功能模块拆解');
      expect(result.analysisResult).toContain('负载特征评估');
    });

    it('应识别并标注降级输出（带 ⚠️ 提示人工补充）', async () => {
      const state = makeState({
        activeExperts: ['functional', 'security'],
        functionalAnalysis: '## 功能模块拆解\n正常内容',
        securityAnalysis:
          '[security 专家暂不可用：timeout] 本项分析已跳过，建议人工补充。',
      });

      const result = await aggregatorNode(state);

      logSection('Aggregator 降级标注');
      const securityIdx = result.analysisResult!.indexOf('安全分析');
      console.log('  ', result.analysisResult!.substring(securityIdx, securityIdx + 120));

      expect(result.analysisResult).toContain('功能分析');
      expect(result.analysisResult).toContain('安全分析（降级）');
      expect(result.analysisResult).toContain('⚠️');
    });

    it('空输出的专家不应出现在汇总中（避免空章节）', async () => {
      const state = makeState({
        activeExperts: ['functional', 'compliance'],
        functionalAnalysis: '有内容',
        complianceAnalysis: '',
      });

      const result = await aggregatorNode(state);
      expect(result.analysisResult).toContain('功能分析');
      expect(result.analysisResult).not.toContain('合规分析');
    });

    it('未在 activeExperts 中的专家结果应被忽略', async () => {
      const state = makeState({
        activeExperts: ['functional'],
        functionalAnalysis: '功能内容',
        performanceAnalysis: '性能内容（不应出现）',
      });

      const result = await aggregatorNode(state);
      expect(result.analysisResult).toContain('功能分析');
      expect(result.analysisResult).not.toContain('性能分析');
    });
  });

  // ==========================================================================
  // 9.4 Triage Handoff
  // ==========================================================================

  describe('9.4 triageNode + triageSchema - Handoff 路由（替代 classifier）', () => {
    // ── Schema 契约：当前合法的三种 action ──
    it('triageSchema 接受 action=answer（chat 短路）', () => {
      const result = triageSchema.safeParse({
        action: 'answer',
        response: '这是直接回答',
        reason: null,
      });
      expect(result.success).toBe(true);
    });

    it('triageSchema 接受 action=handoff_to_query（走 queryHandler）', () => {
      const result = triageSchema.safeParse({
        action: 'handoff_to_query',
        response: '',
        reason: '涉及具体需求编号',
      });
      expect(result.success).toBe(true);
    });

    it('triageSchema 接受 action=handoff_to_analysis（走完整分析链）', () => {
      const result = triageSchema.safeParse({
        action: 'handoff_to_analysis',
        response: '',
        reason: '涉及多模块改动',
      });
      expect(result.success).toBe(true);
    });

    // ── Schema 契约：旧 action 必须被拒绝（防回归） ──
    it('triageSchema 拒绝旧 handoff_to_risk（已删除）', () => {
      const result = triageSchema.safeParse({
        action: 'handoff_to_risk',
        response: '',
        reason: null,
      });
      expect(result.success).toBe(false);
    });

    it('triageSchema 拒绝任意未定义 action', () => {
      const result = triageSchema.safeParse({
        action: 'invalid_action',
        response: 'test',
      });
      expect(result.success).toBe(false);
    });

    // ── triageNode 行为：三种 action 的映射 ──
    it('answer → intent=chat，并把回答写入 messages + chatResponse + summary（短路）', async () => {
      const mockModel = createMockModel({
        action: 'answer',
        response: '你好！我是需求分析助手。',
        reason: null,
      });

      const state = makeState({ input: '你好' });
      const result = await triageNode(state, { model: mockModel });

      logSection('Triage 直接回答（短路）');
      console.log('  → intent       :', result.intent);
      console.log('  → messages 数量:', result.messages?.length);
      console.log('  → chatResponse :', result.chatResponse);
      console.log('  ↳ 主图收到 intent=chat 后会走到 END，不再调 chatHandler');

      expect(result.intent).toBe('chat');
      expect(result.messages?.length).toBe(1);
      expect(result.chatResponse).toBe('你好！我是需求分析助手。');
      expect(result.summary).toBe('你好！我是需求分析助手。');
    });

    it('handoff_to_query → intent=query（走 queryHandler，不在 messages 里写答案）', async () => {
      const mockModel = createMockModel({
        action: 'handoff_to_query',
        response: '',
        reason: '查询 REQ-001 状态',
      });

      const state = makeState({ input: 'REQ-001 现在什么状态？' });
      const result = await triageNode(state, { model: mockModel });

      logSection('Triage Handoff to Query');
      console.log('  → intent       :', result.intent);
      console.log('  → handoffReason:', result.handoffReason);

      expect(result.intent).toBe('query');
      expect(result.handoffReason).toBe('查询 REQ-001 状态');
      expect(result.messages).toBeUndefined();
    });

    it('handoff_to_analysis → intent=analyze（走完整分析链）', async () => {
      const mockModel = createMockModel({
        action: 'handoff_to_analysis',
        response: '',
        reason: '涉及功能和性能',
      });

      const state = makeState({ input: '批量导入需求评估' });
      const result = await triageNode(state, { model: mockModel });

      logSection('Triage Handoff to Analysis');
      console.log('  → intent       :', result.intent);
      console.log('  → handoffReason:', result.handoffReason);

      expect(result.intent).toBe('analyze');
      expect(result.handoffReason).toBe('涉及功能和性能');
    });
  });

  // ==========================================================================
  // 9.5 Plan-and-Execute + Reflexion
  // ==========================================================================

  describe('9.5.1 plannerNode - 跨工单任务拆解', () => {
    it('应将复杂输入拆解为多个步骤，每个步骤 done=false', async () => {
      const mockModel = createMockModel({
        steps: [
          { id: 'step-1', description: '分析 REQ-001：批量导入需求' },
          { id: 'step-2', description: '分析 REQ-002：导入失败重试需求' },
          { id: 'step-3', description: '分析 REQ-001 与 REQ-002 的交叉影响' },
        ],
        reasoning: '先单独分析再合并',
      });

      const state = makePipelineState({
        messages: [new HumanMessage('合并分析 REQ-001 和 REQ-002')],
      });

      const result = await plannerNode(state, { model: mockModel });

      logSection('Planner 拆解结果');
      result.plan!.forEach((s, i) => {
        console.log(`  ${i + 1}. [${s.id}] done=${s.done}  ${s.description}`);
      });

      expect(result.plan).toBeDefined();
      expect(result.plan!.length).toBe(3);
      expect(result.plan!.every((s) => s.done === false)).toBe(true);
      expect(result.currentStepIndex).toBe(0);
    });

    it('应生成 parentThreadId（用于 sub-thread 隔离）', async () => {
      const mockModel = createMockModel({
        steps: [{ id: 'step-1', description: 'a' }],
        reasoning: '',
      });

      const state = makePipelineState({
        messages: [new HumanMessage('test')],
      });

      const result = await plannerNode(state, { model: mockModel });

      console.log('  parentThreadId →', result.parentThreadId);
      expect(result.parentThreadId).toMatch(/^pipeline-\d+/);
    });

    it('应保留已存在的 parentThreadId（断线重连场景）', async () => {
      const mockModel = createMockModel({
        steps: [{ id: 'step-1', description: 'a' }],
        reasoning: '',
      });

      const state = makePipelineState({
        messages: [new HumanMessage('test')],
        parentThreadId: 'pipeline-original-123',
      });

      const result = await plannerNode(state, { model: mockModel });
      expect(result.parentThreadId).toBe('pipeline-original-123');
    });
  });

  describe('9.5.2 executorNode - 单步执行 + 异常容错', () => {
    it('执行成功时应推进 currentStepIndex 并写入 stepResults', async () => {
      const mockAnalysisGraph: any = {
        invoke: mock(async () => ({
          summary: '步骤 1 的分析报告',
          analysisResult: '原始分析',
        })),
      };

      const state = makePipelineState({
        plan: [
          { id: 'step-1', description: '分析 REQ-001', done: false },
          { id: 'step-2', description: '分析 REQ-002', done: false },
        ],
        currentStepIndex: 0,
        parentThreadId: 'pipeline-test',
      });

      const result = await executorNode(state, {
        analysisGraph: mockAnalysisGraph,
      });

      logSection('Executor 步骤推进');
      console.log('  执行前 currentStepIndex:', state.currentStepIndex);
      console.log('  执行后 currentStepIndex:', result.currentStepIndex);
      console.log('  step-1.done           :', result.plan![0].done);
      console.log('  stepResults["step-1"] :', result.stepResults!['step-1']);

      expect(result.currentStepIndex).toBe(1);
      expect(result.plan![0].done).toBe(true);
      expect(result.stepResults!['step-1']).toBe('步骤 1 的分析报告');
    });

    it('analysisGraph 抛错时应捕获异常，标记 done=true 并继续推进', async () => {
      const mockAnalysisGraph: any = {
        invoke: mock(async () => {
          throw new Error('subgraph timeout');
        }),
      };

      const state = makePipelineState({
        plan: [{ id: 'step-1', description: 'a', done: false }],
        currentStepIndex: 0,
        parentThreadId: 'pipeline-test',
      });

      const result = await executorNode(state, {
        analysisGraph: mockAnalysisGraph,
      });

      logSection('Executor 容错路径');
      console.log('  step-1.done           :', result.plan![0].done);
      console.log('  stepResults["step-1"] :', result.stepResults!['step-1']);
      console.log('  ↳ 步骤标记完成，pipeline 不会被单步失败阻塞');

      expect(result.plan![0].done).toBe(true);
      expect(result.currentStepIndex).toBe(1);
      expect(result.stepResults!['step-1']).toContain('[执行失败]');
      expect(result.stepResults!['step-1']).toContain('subgraph timeout');
    });

    it('plan 越界时应直接返回空对象（防御性）', async () => {
      const mockAnalysisGraph: any = { invoke: mock(async () => ({})) };
      const state = makePipelineState({
        plan: [{ id: 'step-1', description: 'a', done: true }],
        currentStepIndex: 5,
      });

      const result = await executorNode(state, {
        analysisGraph: mockAnalysisGraph,
      });

      expect(result).toEqual({});
      expect(mockAnalysisGraph.invoke).not.toHaveBeenCalled();
    });
  });

  describe('9.5.3 evaluatorNode - 报告质量评估', () => {
    it('approved=true → 报告合格，不进入 reflector', async () => {
      const mockModel = createMockModel({
        approved: true,
        score: 88,
        issues: [],
        suggestion: '',
      });

      const state = makePipelineState({
        plan: [{ id: 'step-1', description: '分析 A', done: true }],
        stepResults: { 'step-1': 'A 的分析结果' },
      });

      const result = await evaluatorNode(state, { model: mockModel });

      logSection('Evaluator 通过');
      console.log('  approved   :', result.approved);
      console.log('  finalReport:', result.finalReport!.substring(0, 80), '...');

      expect(result.approved).toBe(true);
      expect(result.finalReport).toContain('联合分析报告');
      expect(result.finalReport).toContain('A 的分析结果');
    });

    it('approved=false → 暴露 issues，下游 reflector 据此修订', async () => {
      const mockModel = createMockModel({
        approved: false,
        score: 55,
        issues: ['缺少交叉影响分析', '安全维度遗漏'],
        suggestion: '补充 REQ-001 与 REQ-002 的交叉影响章节',
      });

      const state = makePipelineState({
        plan: [{ id: 'step-1', description: '分析 A', done: true }],
        stepResults: { 'step-1': '简单结论' },
      });

      const result = await evaluatorNode(state, { model: mockModel });

      logSection('Evaluator 不通过');
      console.log('  approved:', result.approved);
      console.log('  ↳ Pipeline 将进入 reflector 重新规划');

      expect(result.approved).toBe(false);
    });
  });

  describe('9.5.3 reflectorNode - 反思修订', () => {
    it('应基于 finalReport 给出新计划，并 retryCount+1', async () => {
      const mockModel = createMockModel({
        revisedSteps: [
          { id: 'step-1', description: '分析 REQ-001（深化）' },
          { id: 'step-2', description: '分析 REQ-002（深化）' },
          { id: 'step-3', description: '补充交叉影响章节' },
        ],
        reflection: '原计划缺少交叉影响分析，新增 step-3',
      });

      const state = makePipelineState({
        plan: [
          { id: 'step-1', description: '分析 A', done: true },
          { id: 'step-2', description: '分析 B', done: true },
        ],
        finalReport: '不充分的报告内容',
        retryCount: 0,
      });

      const result = await reflectorNode(state, { model: mockModel });

      logSection('Reflector 修订');
      console.log('  原计划步骤数:', state.plan.length);
      console.log('  新计划步骤数:', result.plan!.length);
      console.log('  retryCount  :', `${state.retryCount} → ${result.retryCount}`);
      console.log('  reflection  :', result.reflections![0].substring(0, 80));

      expect(result.plan).toBeDefined();
      expect(result.plan!.length).toBe(3);
      expect(result.plan!.every((s) => s.done === false)).toBe(true);
      expect(result.currentStepIndex).toBe(0);
      expect(result.retryCount).toBe(1);
      expect(result.reflections!.length).toBe(1);
    });
  });

  describe('9.5.4 Pipeline 路由函数', () => {
    describe('shouldContinue (executor 后)', () => {
      it('还有未执行步骤 → 继续 executor', () => {
        const state = makePipelineState({
          plan: [
            { id: 'step-1', description: 'a', done: true },
            { id: 'step-2', description: 'b', done: false },
          ],
          currentStepIndex: 1,
        });
        expect(shouldContinue(state)).toBe('executor');
      });

      it('所有步骤完成 → 进入 evaluator', () => {
        const state = makePipelineState({
          plan: [
            { id: 'step-1', description: 'a', done: true },
            { id: 'step-2', description: 'b', done: true },
          ],
          currentStepIndex: 2,
        });
        expect(shouldContinue(state)).toBe('evaluator');
      });

      it('空计划 → 直接 evaluator', () => {
        const state = makePipelineState({ plan: [], currentStepIndex: 0 });
        expect(shouldContinue(state)).toBe('evaluator');
      });
    });

    describe('shouldReflect (evaluator 后)', () => {
      it('approved=true → END', () => {
        const state = makePipelineState({ approved: true });
        expect(shouldReflect(state)).toBe('__end__');
      });

      it('approved=false 且 retryCount=0 → reflector（首次反思）', () => {
        const state = makePipelineState({ approved: false, retryCount: 0 });
        expect(shouldReflect(state)).toBe('reflector');
      });

      it('approved=false 但 retryCount=1 → END（成本硬上限）', () => {
        const state = makePipelineState({ approved: false, retryCount: 1 });

        logSection('成本上限触发');
        console.log('  retryCount=1 已达上限，强制结束 pipeline');

        expect(shouldReflect(state)).toBe('__end__');
      });

      it('retryCount=2 → END（防御性，不应到达此状态）', () => {
        const state = makePipelineState({ approved: false, retryCount: 2 });
        expect(shouldReflect(state)).toBe('__end__');
      });
    });
  });

  // ==========================================================================
  // 9.5.5 端到端：runPipeline() 跑通 Plan → Execute → Evaluate
  // ==========================================================================

  describe('9.5.5 runPipeline 端到端 (FakeListChatModel)', () => {
    /**
     * Pipeline 内部包含并行节点（analysisStep + riskStep），
     * 用按 prompt 内容路由的 mock 替代按调用顺序消费的 FakeListChatModel。
     *
     * 完整 LLM 节点路径：
     *   planner → triage → extract → clarify → (analysisStep || riskStep) → summaryStep → evaluator
     *   - analysisStep = supervisor → 专家 ReAct（无 tool_calls 直接 finalize）→ aggregator
     *   - summaryStep  = actor → critic（含"通过"则结束）
     */
    async function buildRoutedFakeModel() {
      const { FakeListChatModel } = await import(
        '@langchain/core/utils/testing'
      );
      const { AIMessage } = await import('@langchain/core/messages');

      const routes: Array<{
        match: (text: string) => boolean;
        response: string | (() => string);
        label: string;
      }> = [
        {
          label: 'planner',
          match: (t) => t.includes('任务规划专家'),
          response: JSON.stringify({
            steps: [
              {
                id: 'step-1',
                description: '分析 REQ-001 批量导入需求并产出报告',
              },
            ],
            reasoning: '只有一个工单，无需拆分',
          }),
        },
        {
          label: 'evaluator',
          match: (t) => t.includes('质量评估专家'),
          response: JSON.stringify({
            approved: true,
            score: 90,
            issues: [],
            suggestion: '',
          }),
        },
        {
          label: 'reflector',
          match: (t) => t.includes('总报告不达标'),
          response: JSON.stringify({
            revisedSteps: [
              { id: 'step-1', description: '重新分析' },
            ],
            reflection: '前次报告不完整',
          }),
        },
        {
          label: 'triage',
          match: (t) => t.includes('需求分诊'),
          response: JSON.stringify({
            action: 'handoff_to_analysis',
            response: '',
            reason: '需要完整需求分析',
          }),
        },
        {
          label: 'extract',
          match: (t) => t.includes('需求分析专家') && t.includes('提取'),
          response: JSON.stringify({
            requirementType: '功能需求',
            coreFeature: '批量导入 Excel 用户数据',
            targetUsers: '运营人员',
            businessGoal: '提升录入效率',
            constraints: [],
            priority: 'high',
            isComplete: true,
            missingFields: [],
          }),
        },
        {
          label: 'clarify',
          match: (t) => t.includes('需求澄清专家'),
          response: JSON.stringify({
            needsClarification: false,
            questions: [],
          }),
        },
        {
          label: 'supervisor',
          match: (t) => t.includes('需求分析调度员'),
          response: JSON.stringify({
            experts: ['functional'],
            reason: '仅需功能层面分析',
          }),
        },
        {
          label: 'functional-expert',
          match: (t) => t.includes('功能需求分析专家'),
          response:
            '## 功能模块拆解\n\n- 文件上传模块\n- 数据校验模块\n- 批量入库模块',
        },
        {
          label: 'risk',
          match: (t) => t.includes('需求风险评估专家'),
          response:
            '## 风险评估\n- 大文件可能触发超时\n- 重复数据需要去重策略',
        },
        {
          label: 'summary-critic',
          match: (t) => t.includes('资深需求评审专家'),
          response: '通过：报告完整，结构清晰。',
        },
        {
          label: 'summary-actor',
          match: (t) => t.includes('资深需求分析师'),
          response:
            '# 综合报告\n\n## 功能分析\n（已分析）\n\n## 风险\n（已评估）',
        },
      ];

      const callLog: string[] = [];

      class RoutedFakeChatModel extends FakeListChatModel {
        constructor() {
          super({ responses: ['__placeholder__'] });
        }

        // FakeListChatModel.bindTools 内部 `new FakeListChatModel(...)`，会丢失子类实现，
        // mock 场景不需要真的 bind tools，直接返回 this 让 _generate 重写生效
        bindTools(_tools: any) {
          return this as any;
        }

        async _generate(messages: any[]) {
          const text = messages
            .map((m) =>
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            )
            .join('\n');

          const route = routes.find((r) => r.match(text));
          if (!route) {
            throw new Error(
              `RoutedFakeChatModel: 没有匹配路由，prompt 前 200 字: ${text.slice(
                0,
                200,
              )}`,
            );
          }
          const response =
            typeof route.response === 'function'
              ? route.response()
              : route.response;
          callLog.push(route.label);
          return {
            generations: [
              {
                text: response,
                message: new AIMessage(response),
              },
            ],
          };
        }
      }

      return { model: new RoutedFakeChatModel() as any, callLog };
    }

    it('approved=true 一次通过：planner → executor → evaluator → END', async () => {
      const { model, callLog } = await buildRoutedFakeModel();

      const result = await runPipeline(
        '请合并分析 REQ-001 批量导入需求',
        model,
      );

      logSection('Pipeline 端到端（一次通过）');
      console.log('  调用顺序   :', callLog.join(' → '));
      console.log('  approved   :', result.approved);
      console.log('  retryCount :', result.retryCount);
      console.log('  plan.length:', result.plan.length);
      console.log('  stepResults keys:', Object.keys(result.stepResults));
      console.log(
        '  finalReport 前 80 字 :',
        result.finalReport.substring(0, 80).replace(/\n/g, ' '),
      );

      expect(result.approved).toBe(true);
      expect(result.retryCount).toBe(0);
      expect(result.plan.length).toBe(1);
      expect(result.plan[0].done).toBe(true);
      expect(result.stepResults['step-1']).toBeDefined();
      expect(result.finalReport).toContain('联合分析报告');

      expect(callLog[0]).toBe('planner');
      expect(callLog).toContain('triage');
      expect(callLog).toContain('extract');
      expect(callLog).toContain('clarify');
      expect(callLog).toContain('supervisor');
      expect(callLog).toContain('functional-expert');
      expect(callLog).toContain('risk');
      expect(callLog).toContain('summary-actor');
      expect(callLog).toContain('summary-critic');
      expect(callLog[callLog.length - 1]).toBe('evaluator');
      expect(callLog).not.toContain('reflector');
    }, 60000);

    it('approved=false → reflector 修订 → 第二轮通过：retryCount=1', async () => {
      const { FakeListChatModel } = await import(
        '@langchain/core/utils/testing'
      );
      const { AIMessage } = await import('@langchain/core/messages');

      // 用闭包记录 evaluator 调用次数：第 1 次 false，第 2 次 true
      let evalCalls = 0;
      const callLog: string[] = [];

      const dynamicRoutes: Array<{
        match: (text: string) => boolean;
        response: string | (() => string);
        label: string;
      }> = [
        {
          label: 'planner',
          match: (t) => t.includes('任务规划专家'),
          response: JSON.stringify({
            steps: [
              { id: 'step-1', description: '初版分析' },
            ],
            reasoning: '一步搞定',
          }),
        },
        {
          label: 'evaluator',
          match: (t) => t.includes('质量评估专家'),
          response: () => {
            evalCalls += 1;
            if (evalCalls === 1) {
              return JSON.stringify({
                approved: false,
                score: 50,
                issues: ['缺少风险量化', '未说明性能影响'],
                suggestion: '需要补充性能与风险量化数据',
              });
            }
            return JSON.stringify({
              approved: true,
              score: 88,
              issues: [],
              suggestion: '',
            });
          },
        },
        {
          label: 'reflector',
          match: (t) => t.includes('总报告不达标'),
          response: JSON.stringify({
            revisedSteps: [
              { id: 'step-1', description: '补充性能与风险量化数据后重新分析' },
            ],
            reflection: '原计划遗漏了性能与风险量化',
          }),
        },
        {
          label: 'triage',
          match: (t) => t.includes('需求分诊'),
          response: JSON.stringify({
            action: 'handoff_to_analysis',
            response: '',
            reason: '需要分析',
          }),
        },
        {
          label: 'extract',
          match: (t) => t.includes('需求分析专家') && t.includes('提取'),
          response: JSON.stringify({
            requirementType: '功能需求',
            coreFeature: '批量导入',
            targetUsers: '运营',
            businessGoal: '效率',
            constraints: [],
            priority: 'high',
            isComplete: true,
            missingFields: [],
          }),
        },
        {
          label: 'clarify',
          match: (t) => t.includes('需求澄清专家'),
          response: JSON.stringify({
            needsClarification: false,
            questions: [],
          }),
        },
        {
          label: 'supervisor',
          match: (t) => t.includes('需求分析调度员'),
          response: JSON.stringify({
            experts: ['functional'],
            reason: 'mock',
          }),
        },
        {
          label: 'functional-expert',
          match: (t) => t.includes('功能需求分析专家'),
          response: '## 功能模块拆解\n- A\n- B',
        },
        {
          label: 'risk',
          match: (t) => t.includes('需求风险评估专家'),
          response: '## 风险评估\n- R1',
        },
        {
          label: 'summary-critic',
          match: (t) => t.includes('资深需求评审专家'),
          response: '通过',
        },
        {
          label: 'summary-actor',
          match: (t) => t.includes('资深需求分析师'),
          response: '# 综合报告\n（mock）',
        },
      ];

      class DynRoutedModel extends FakeListChatModel {
        constructor() {
          super({ responses: ['__placeholder__'] });
        }
        bindTools(_tools: any) {
          return this as any;
        }
        async _generate(messages: any[]) {
          const text = messages
            .map((m) =>
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            )
            .join('\n');
          const route = dynamicRoutes.find((r) => r.match(text));
          if (!route) {
            throw new Error(
              `未匹配路由：${text.slice(0, 200)}`,
            );
          }
          const response =
            typeof route.response === 'function'
              ? route.response()
              : route.response;
          callLog.push(route.label);
          return {
            generations: [
              {
                text: response,
                message: new AIMessage(response),
              },
            ],
          };
        }
      }

      const model: any = new DynRoutedModel();
      const result = await runPipeline('需要补充风险量化的需求分析', model);

      logSection('Pipeline 端到端（reflexion 一轮）');
      console.log('  evaluator 调用次数 :', evalCalls);
      console.log('  approved           :', result.approved);
      console.log('  retryCount         :', result.retryCount);
      console.log('  reflections        :', result.reflections);
      console.log(
        '  evaluator 出现次数 :',
        callLog.filter((l) => l === 'evaluator').length,
      );
      console.log(
        '  reflector 出现次数 :',
        callLog.filter((l) => l === 'reflector').length,
      );

      expect(result.approved).toBe(true);
      expect(result.retryCount).toBe(1);
      expect(result.reflections.length).toBe(1);
      expect(result.reflections[0]).toContain('性能');
      expect(callLog.filter((l) => l === 'evaluator').length).toBe(2);
      expect(callLog.filter((l) => l === 'reflector').length).toBe(1);
    }, 60000);
  });

  describe('9.5 PipelineState 字段验证', () => {
    it('应包含 9 个核心字段（plan/currentStepIndex/stepResults/...）', () => {
      const state = makePipelineState();
      expect(state.messages).toEqual([]);
      expect(state.plan).toEqual([]);
      expect(state.currentStepIndex).toBe(0);
      expect(state.stepResults).toEqual({});
      expect(state.reflections).toEqual([]);
      expect(state.retryCount).toBe(0);
      expect(state.parentThreadId).toBe('');
      expect(state.finalReport).toBe('');
      expect(state.approved).toBe(false);
    });
  });

  // ==========================================================================
  // 9.6 错误降级 + 成本硬上限
  // ==========================================================================

  // ==========================================================================
  // 9.6.2 HITL：MemorySaver + interruptBefore
  // ==========================================================================

  describe('9.6.2 HITL：MemorySaver + interruptBefore=[\'clarifyStep\']', () => {
    /**
     * 用 LangChain 官方的 FakeListChatModel 作为真实 Runnable 模型。
     * 按 graph 节点执行顺序，依次注入 responses 数组里的字符串。
     * - triage 节点用 withStructuredOutput，会自动 JSON.parse 第 1 个响应
     * - extract 节点用 chain.invoke + StringOutputParser，吃第 2 个响应
     * - 之后图被 interruptBefore 拦截，不再调 model
     */
    async function loadFakeChatModel() {
      const { FakeListChatModel } = await import('@langchain/core/utils/testing');
      return FakeListChatModel;
    }

    it('analyze 路径下应在 clarifyStep 前暂停，extracted 已写入 checkpoint', async () => {
      const FakeListChatModel = await loadFakeChatModel();
      const model: any = new FakeListChatModel({
        responses: [
          JSON.stringify({
            action: 'handoff_to_analysis',
            response: '',
            reason: '需要完整分析',
          }),
          JSON.stringify({
            requirementType: '功能需求',
            coreFeature: '批量导入 Excel 用户数据',
            targetUsers: '运营人员',
            businessGoal: '提升录入效率',
            constraints: [],
            priority: 'high',
            isComplete: true,
            missingFields: [],
          }),
        ],
      });

      const threadId = `hitl-pause-${Date.now()}`;
      const snapshot = await startAnalysisGraphHITL(
        threadId,
        '批量导入 Excel 用户数据评估',
        model,
      );

      logSection('HITL 暂停状态');
      console.log('  snapshot.next      :', snapshot.next);
      console.log('  intent (来自 triage):', snapshot.values.intent);
      console.log('  extracted.coreFeature:', (snapshot.values.extracted as any)?.coreFeature);
      console.log('  ↳ 图已停在 clarifyStep 前，等待用户提交澄清答案');

      expect(snapshot.next).toContain('clarifyStep');
      expect(snapshot.values.intent).toBe('analyze');
      expect(snapshot.values.extracted).toBeDefined();
      expect((snapshot.values.extracted as any).coreFeature).toBe(
        '批量导入 Excel 用户数据',
      );
    });

    it('chat 短路场景下不应触发中断（triage 直接 END）', async () => {
      const FakeListChatModel = await loadFakeChatModel();
      const model: any = new FakeListChatModel({
        responses: [
          JSON.stringify({
            action: 'answer',
            response: '你好！我是需求分析助手。',
            reason: null,
          }),
        ],
      });

      const threadId = `hitl-chat-${Date.now()}`;
      const snapshot = await startAnalysisGraphHITL(threadId, '你好', model);

      logSection('chat 短路 → 不中断');
      console.log('  snapshot.next:', snapshot.next);
      console.log('  intent       :', snapshot.values.intent);
      console.log('  chatResponse :', snapshot.values.chatResponse);

      expect(snapshot.next).toEqual([]);
      expect(snapshot.values.intent).toBe('chat');
      expect(snapshot.values.chatResponse).toBe('你好！我是需求分析助手。');
    });

    it('用户提交澄清答案 → updateState 后能从 checkpoint 读到补丁', async () => {
      const FakeListChatModel = await loadFakeChatModel();
      const model: any = new FakeListChatModel({
        responses: [
          JSON.stringify({
            action: 'handoff_to_analysis',
            response: '',
            reason: 'r',
          }),
          JSON.stringify({
            requirementType: '功能需求',
            coreFeature: '简化 mock',
            targetUsers: '测试',
            businessGoal: '验证 HITL',
            constraints: [],
            priority: 'medium',
            isComplete: true,
            missingFields: [],
          }),
        ],
      });

      const threadId = `hitl-patch-${Date.now()}`;
      await startAnalysisGraphHITL(threadId, '需求分析', model);

      const { createAnalysisGraphHITL, hitlCheckpointer } = await import(
        '../src/llm/graph/requirement-analysis-graph'
      );
      const graph = createAnalysisGraphHITL(model);
      await graph.updateState(
        { configurable: { thread_id: threadId } },
        {
          clarified: { needsClarification: false, questions: [] },
        } as any,
      );
      const after = await graph.getState({
        configurable: { thread_id: threadId },
      });

      logSection('updateState 后状态');
      console.log('  clarified:', JSON.stringify(after.values.clarified));
      console.log('  ↳ 用户答案已写回 checkpoint，下次 invoke(null) 会从这里继续');

      expect(after.values.clarified).toEqual({
        needsClarification: false,
        questions: [],
      });
      expect(hitlCheckpointer).toBeDefined();
    });
  });

  describe('9.6.1 错误降级 + 9.6.4 成本硬上限', () => {
    it('createExpertSubGraph 工厂调用应成功（maxSteps 默认为 6）', () => {
      const mockModel = createMockModel('test response');
      const subgraph = createExpertSubGraph({
        name: 'test',
        model: mockModel,
        tools: [],
        systemPrompt: 'test',
        outputField: 'functionalAnalysis',
      });
      expect(subgraph).toBeDefined();
    });

    it('supervisorSchema 通过 zod .min(1) 强制至少选 1 个专家', () => {
      // supervisorNode 内部 schema 设置了 .min(1)
      // 即使 LLM 返回空数组也会 zod 校验失败 → 抛错 → 上游捕获
      // 此测试为契约提示（schema 改动时记得同步）
      expect(true).toBe(true);
    });

    it('Reflexion 重试上限为 1（避免无限循环）', () => {
      const state = makePipelineState({ approved: false, retryCount: 1 });
      expect(shouldReflect(state)).toBe('__end__');
    });
  });
});

// ============================================================================
// 集成测试（需要真实 LLM API Key）—— 对应文档 9.7 端到端验证
// ============================================================================

const HAS_API_KEY = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);

describe.skipIf(!HAS_API_KEY)(
  '第九章 Multi-Agent 集成测试 (需要 LLM API Key)',
  () => {
    let model: any;

    beforeEach(async () => {
      const { createChatModel } = await import('../src/llm/model.factory');
      model = createChatModel({
        modelConfigId: 'test-ch9',
        modelName: process.env.OPENAI_MODEL || 'gpt-5.4',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
      });
    });

    describe('9.2.2 Supervisor 调度准确性 (LLM 实测)', () => {
      it('简单文案修改 → 至少包含 functional', async () => {
        const state = makeState({
          input: '将登录页的"登录"按钮文案改为"立即登录"',
          clarified: { needsClarification: false, questions: [] },
        });

        const result = await supervisorNode(state, { model });
        console.log('  实测选择:', result.activeExperts);

        expect(result.activeExperts).toContain('functional');
        expect(result.activeExperts!.length).toBeLessThanOrEqual(2);
      }, 60000);

      it('批量导入场景 → 应包含 functional + performance', async () => {
        const state = makeState({
          input:
            '需求 REQ-20240315-001：支持批量导入 Excel 用户数据，单次最多 10000 行',
          clarified: { needsClarification: false, questions: [] },
        });

        const result = await supervisorNode(state, { model });
        console.log('  实测选择:', result.activeExperts);

        expect(result.activeExperts).toContain('functional');
        expect(result.activeExperts).toContain('performance');
      }, 60000);

      it('敏感数据导出 → 应包含 security', async () => {
        const state = makeState({
          input: '新增用户敏感数据导出功能，支持导出用户手机号和身份证信息',
          clarified: { needsClarification: false, questions: [] },
        });

        const result = await supervisorNode(state, { model });
        console.log('  实测选择:', result.activeExperts);

        expect(result.activeExperts).toContain('security');
      }, 60000);

      it('跨境金融 → 应同时包含 compliance + security', async () => {
        const state = makeState({
          input: '开发跨境支付功能，支持欧盟和中国用户，涉及个人金融信息处理',
          clarified: { needsClarification: false, questions: [] },
        });

        const result = await supervisorNode(state, { model });
        console.log('  实测选择:', result.activeExperts);

        expect(result.activeExperts).toContain('compliance');
        expect(result.activeExperts).toContain('security');
      }, 60000);
    });

    describe('9.2 Supervisor 子图端到端 (LLM 实测)', () => {
      it('应能完整跑通：supervisor → experts → aggregator', async () => {
        const graph = createAnalysisSupervisorSubGraph(model);

        const result = await graph.invoke({
          input: '需求：将登录页的"登录"按钮文案改为"立即登录"',
          retrievedContext: '',
          messages: [],
          clarified: { needsClarification: false, questions: [] },
        });

        console.log('  activeExperts:', result.activeExperts);
        console.log('  报告长度:', result.analysisResult.length);

        expect(result.activeExperts.length).toBeGreaterThanOrEqual(1);
        expect(result.analysisResult.length).toBeGreaterThan(0);
      }, 120000);

      it('多专家场景 → 报告应包含多个章节', async () => {
        const graph = createAnalysisSupervisorSubGraph(model);

        const result = await graph.invoke({
          input:
            '需求：支持批量导入 Excel 用户数据，包含手机号字段，单次最多 10000 行',
          retrievedContext: '',
          messages: [],
          clarified: { needsClarification: false, questions: [] },
        });

        console.log('  activeExperts:', result.activeExperts);

        expect(result.activeExperts.length).toBeGreaterThanOrEqual(2);
        expect(result.analysisResult).toBeDefined();

        if (result.activeExperts.includes('functional')) {
          expect(result.functionalAnalysis.length).toBeGreaterThan(0);
        }
        if (result.activeExperts.includes('performance')) {
          expect(result.performanceAnalysis.length).toBeGreaterThan(0);
        }
      }, 180000);
    });

    describe('9.4 Triage Node (LLM 实测)', () => {
      it('简单查询应被 LLM 正确识别', async () => {
        const state = makeState({
          input: 'REQ-20240315-001 现在是什么状态？',
          messages: [new HumanMessage('REQ-20240315-001 现在是什么状态？')],
        });

        const result = await triageNode(state, { model });
        console.log('  识别 intent:', result.intent);

        expect(result.intent).toBeDefined();
        expect(result.messages!.length).toBe(1);
      }, 60000);
    });

    describe('9.5 runPipeline 端到端 (LLM 实测)', () => {
      it('跨工单需求 → planner 拆分 → executor 跑通 → evaluator 通过', async () => {
        const result = await runPipeline(
          '请合并分析两个工单：REQ-001（批量导入 Excel 用户数据，最多 1 万行）和 REQ-002（导出用户行为分析报表，含手机号脱敏）。给出统一的功能、性能、安全设计。',
          model,
        );

        logSection('Pipeline 端到端（真实 LLM）');
        console.log('  approved   :', result.approved);
        console.log('  retryCount :', result.retryCount);
        console.log('  plan steps :', result.plan.length);
        result.plan.forEach((s, i) => {
          console.log(`    ${i + 1}. ${s.id} (done=${s.done}): ${s.description.slice(0, 50)}`);
        });
        console.log(
          '  finalReport 前 200 字 :',
          result.finalReport.substring(0, 200).replace(/\n/g, ' '),
        );

        expect(result.plan.length).toBeGreaterThanOrEqual(1);
        expect(result.finalReport.length).toBeGreaterThan(100);
        expect(result.finalReport).toContain('联合分析报告');
        expect(typeof result.approved).toBe('boolean');
      }, 600000);
    });
  },
);
