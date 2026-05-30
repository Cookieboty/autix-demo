/**
 * deep-orchestrator.service.ts — 第十五章配套模块
 *
 * 把第九章的 createAnalysisGraph（已编译 LangGraph）以「子 Agent」形式接入 DeepAgent，
 * 由 DeepAgent 做外层跨工单编排（write_todos + 虚拟文件系统 + task 委派），
 * LangGraph 图做子 Agent 内部的精确控制（Supervisor + 4 专家 + Critic-Refine）。
 *
 * 设计要点（见第十五章 15.3）：
 * - DeepAgent 的 task 工具用「messages 进 / messages 出」契约调用子 Agent，
 *   而 createAnalysisGraph 用「state.input 字符串」驱动、产出 state.summary。
 *   两个契约不一致，所以这里用 RunnableLambda 做适配器，而不是把编译图直接透传。
 * - 适配器只回 { messages: [AIMessage(summary)] }，让主回路只看到「摘要」，
 *   不把专家中间结论灌回主上下文（对照第九章 9.4 Handoff）。
 *
 * 本模块不挂到现有 OrchestratorService / SSE 路由，既有业务数据流保持不变；
 * 仅作为可被脚本与测试调用的独立模块。
 */
import { createDeepAgent, FilesystemBackend, type CompiledSubAgent, type FilesystemPermission } from 'deepagents';
import { type BaseCheckpointSaver } from '@langchain/langgraph';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { createAnalysisGraph } from '../graph/requirement-analysis-graph';

/** 需求分析子 Agent 的名字，主 Agent 通过 task(subagent_type) 选择它。 */
export const ANALYSIS_SUBAGENT_NAME = 'requirement_analyst';

/** 演示 HITL / 权限用的「保存报告」工具名。 */
export const SAVE_REPORT_TOOL_NAME = 'save_report';

/**
 * 从消息列表里取出最近一条用户文本。
 * task 工具会把委派描述塞进 messages 末尾，这里把它还原成 createAnalysisGraph 需要的 input 字符串。
 */
export function extractLatestUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.getType() === 'human') {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    }
  }
  // 没有 human 消息时退回到最后一条消息文本（task 工具至少会塞一条 HumanMessage）
  const last = messages[messages.length - 1];
  return last ? (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)) : '';
}

/**
 * 把 createAnalysisGraph 适配成 DeepAgent 的 CompiledSubAgent。
 *
 * 契约：入参 { messages }（task 工具传入），出参 { messages: [AIMessage(summary)] }。
 */
export function createAnalysisSubagent(model: BaseChatModel): CompiledSubAgent {
  // 第二个参数 config 必须透传给内层 graph.invoke，否则父级的 callbacks / streamEvents / 追踪
  // 不会穿透到子 Agent，子 Agent 内部第九章那张图的真实 LLM 调用就观测不到。
  const runnable = RunnableLambda.from(async (state: { messages: BaseMessage[] }, config) => {
    const userInput = extractLatestUserText(state.messages ?? []);
    const graph = createAnalysisGraph(model);
    const result = await graph.invoke(
      {
        input: userInput,
        retrievedContext: '',
        messages: [],
      },
      config,
    );
    const summary =
      result.summary || result.queryResponse || result.chatResponse || '（需求分析子 Agent 未产出内容）';
    return { messages: [new AIMessage(summary)] };
  });

  return {
    name: ANALYSIS_SUBAGENT_NAME,
    description:
      '需求分析专家。输入单个工单/需求的描述文本，内部跑第九章 Supervisor + 4 专家并行 + Critic-Refine，返回该需求的综合分析摘要。',
    // 跨包类型标识不一致（deepagents 内置的 Runnable 与本仓库 @langchain/core 的 Runnable 非同一声明），运行时一致，这里做结构化断言。
    runnable: runnable as unknown as CompiledSubAgent['runnable'],
  };
}

export interface DeepOrchestratorOptions {
  model: BaseChatModel;
  /**
   * 本地磁盘根目录。提供则用 FilesystemBackend（文件落到真实磁盘、可跨进程读回）；
   * 不提供则用 DeepAgent 默认的内存态 StateBackend。
   */
  rootDir?: string;
  /** 进程内执行快照。HITL（中断→resume）与断点续跑需要传入。 */
  checkpointer?: BaseCheckpointSaver;
  /** 文件系统权限规则（作用于 ls/read_file/write_file/edit_file/glob/grep）。 */
  permissions?: FilesystemPermission[];
  /** 需要人工审批的工具，例如 { save_report: true }。需配合 checkpointer。 */
  interruptOn?: Record<string, boolean>;
}

const ORCHESTRATOR_SYSTEM_PROMPT = `你是一个跨工单需求分析协调者。

工作方式：
1. 先用 write_todos 把任务拆成「逐个工单分析 + 最终汇总」的步骤。
2. 对每个工单，用 task 工具委派给 ${ANALYSIS_SUBAGENT_NAME} 子 Agent 做深度分析。
3. 把每个工单的分析摘要用 write_file 落到单独的 .md 文件，主回路只保留摘要。
4. 全部工单分析完后，读取这些文件，输出一份「总体影响评估」报告。`;

/**
 * 组装跨工单 DeepAgent 协调者。
 *
 * 外层：DeepAgent（write_todos + 虚拟文件系统 + task 委派）。
 * 内层：createAnalysisGraph 作为 requirement_analyst 子 Agent。
 */
export function createDeepOrchestrator(options: DeepOrchestratorOptions) {
  const { model, rootDir, checkpointer, permissions, interruptOn } = options;

  if (interruptOn && !checkpointer) {
    throw new Error('interruptOn 需要同时传入 checkpointer（HITL 依赖执行快照才能中断与恢复）。');
  }

  const saveReport = new DynamicStructuredTool({
    name: SAVE_REPORT_TOOL_NAME,
    description: '把最终的总体影响评估报告归档（敏感操作，可能需要人工审批）。',
    schema: z.object({
      title: z.string().describe('报告标题'),
      content: z.string().describe('报告正文'),
    }),
    func: async ({ title }) => `已归档报告：《${title}》`,
  });

  return createDeepAgent({
    // 同上：跨包类型标识不一致，运行时兼容，这里断言。
    model: model as never,
    tools: [saveReport] as never,
    subagents: [createAnalysisSubagent(model)],
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    ...(rootDir ? { backend: new FilesystemBackend({ rootDir, virtualMode: true }) } : {}),
    ...(checkpointer ? { checkpointer } : {}),
    ...(permissions ? { permissions } : {}),
    ...(interruptOn ? { interruptOn } : {}),
  });
}
