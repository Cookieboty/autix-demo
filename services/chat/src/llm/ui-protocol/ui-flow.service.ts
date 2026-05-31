/**
 * ui-flow.service.ts
 *
 * 需求分析流程的确定性状态机：
 *   select_type(selection) → fill_detail(form) → confirm(confirmation) → result(steps+card+action_buttons)
 * 每个阶段根据用户操作（UIAction）推进到下一阶段，支持取消回退。
 *
 * 这里不调用 LLM——用户的选择、表单数据、确认操作都是结构化的，无需自然语言解析。
 */
import { Injectable } from '@nestjs/common';
import type { AIUIResponse, UIAction } from './ui-types';

interface SessionContext {
  stage: string;
  collectedData: Record<string, unknown>;
}

const REQ_TYPE_LABELS: Record<string, string> = {
  functional: '功能需求',
  performance: '性能需求',
  security: '安全需求',
  ui_ux: 'UI/UX 需求',
};

@Injectable()
export class UIFlowService {
  private sessions = new Map<string, SessionContext>();

  private getContext(sessionId: string): SessionContext {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { stage: 'init', collectedData: {} });
    }
    return this.sessions.get(sessionId)!;
  }

  /** 处理用户的自然语言输入 */
  handleInput(sessionId: string, input: string): AIUIResponse {
    const ctx = this.getContext(sessionId);

    if (input.includes('需求') || input.includes('功能')) {
      ctx.collectedData.rawInput = input;
      ctx.stage = 'select_type';
      return this.buildSelectType(ctx);
    }

    if (input.includes('查看') || input.includes('查询')) {
      return this.buildRequirementCard(input);
    }

    return {
      message: '请问有什么可以帮您？',
      components: [
        {
          type: 'action_buttons',
          title: '常用功能',
          buttons: [
            { id: 'new_req', label: '提交新需求', icon: '📝', variant: 'primary' },
            { id: 'view_reqs', label: '查看需求列表', icon: '📋', variant: 'secondary' },
            { id: 'search_similar', label: '搜索相似需求', icon: '🔍', variant: 'ghost' },
            { id: 'help', label: '使用帮助', icon: '💬', variant: 'ghost' },
          ],
          layout: 'horizontal',
        },
      ],
    };
  }

  /** 处理用户的 UI 操作 */
  handleAction(sessionId: string, action: UIAction): AIUIResponse {
    const ctx = this.getContext(sessionId);

    switch (ctx.stage) {
      case 'select_type':
        return this.onTypeSelected(ctx, action);
      case 'fill_detail':
        return this.onFormSubmitted(ctx, action);
      case 'confirm':
        return this.onConfirmation(ctx, action);
      default:
        return this.handleButtonAction(ctx, action);
    }
  }

  // ====== Stage 1: 选择需求类型 ======

  private buildSelectType(ctx: SessionContext): AIUIResponse {
    return {
      message: '请先选择需求类型，以便系统匹配最合适的分析模板。',
      components: [
        {
          type: 'selection',
          title: '请选择需求类型',
          options: [
            { id: 'functional', label: '功能需求', description: '新增或修改系统功能', icon: '⚙️' },
            { id: 'performance', label: '性能需求', description: '响应时间、并发量、吞吐率等指标', icon: '⚡' },
            { id: 'security', label: '安全需求', description: '权限控制、数据加密、审计日志等', icon: '🔒' },
            { id: 'ui_ux', label: 'UI/UX 需求', description: '界面交互、用户体验优化', icon: '🎨' },
          ],
          allowMultiple: false,
        },
      ],
      context: { sessionStage: 'select_type', collectedData: ctx.collectedData },
    };
  }

  private onTypeSelected(ctx: SessionContext, action: UIAction): AIUIResponse {
    if (action.payload.type !== 'select') {
      return this.buildSelectType(ctx);
    }
    ctx.collectedData.reqType = action.payload.selectedId;
    ctx.stage = 'fill_detail';
    return this.buildDetailForm(ctx);
  }

  // ====== Stage 2: 填写需求详情 ======

  private buildDetailForm(ctx: SessionContext): AIUIResponse {
    return {
      message: '请补充需求详情，便于系统进行完整性检查与复杂度评估。',
      components: [
        {
          type: 'form',
          title: '需求详情',
          fields: [
            { name: 'title', label: '需求标题', type: 'input', required: true, placeholder: '一句话概括需求' },
            { name: 'description', label: '详细描述', type: 'textarea', required: true, placeholder: '描述使用场景与目标' },
            {
              name: 'priority',
              label: '优先级',
              type: 'select',
              required: true,
              options: [
                { value: 'P0', label: 'P0 - 紧急' },
                { value: 'P1', label: 'P1 - 高' },
                { value: 'P2', label: 'P2 - 中' },
                { value: 'P3', label: 'P3 - 低' },
              ],
            },
            { name: 'acceptanceCriteria', label: '验收标准', type: 'textarea', required: true, placeholder: '可量化的完成标准' },
            { name: 'remark', label: '补充说明', type: 'textarea', required: false },
          ],
          submitLabel: '提交',
        },
      ],
      context: { sessionStage: 'fill_detail', collectedData: ctx.collectedData },
    };
  }

  private onFormSubmitted(ctx: SessionContext, action: UIAction): AIUIResponse {
    if (action.payload.type !== 'submit') {
      return this.buildDetailForm(ctx);
    }
    Object.assign(ctx.collectedData, action.payload.formData);
    ctx.stage = 'confirm';
    return this.buildConfirmation(ctx);
  }

  // ====== Stage 3: 确认提交分析 ======

  private buildConfirmation(ctx: SessionContext): AIUIResponse {
    const data = ctx.collectedData;
    const reqTypeLabel = REQ_TYPE_LABELS[String(data.reqType)] ?? '未知类型';
    return {
      message: '请确认以下需求信息，确认后将进入多 Agent 分析流程。',
      components: [
        {
          type: 'confirmation',
          title: '确认提交分析',
          summary: [
            { label: '需求标题', value: String(data.title ?? '') },
            { label: '需求类型', value: reqTypeLabel },
            { label: '优先级', value: String(data.priority ?? '') },
            { label: '详细描述', value: String(data.description ?? '') },
          ],
          warning: '提交后将触发完整性检查、冲突检测与复杂度评估，分析过程不可中断。',
          confirmLabel: '确认提交',
          cancelLabel: '返回修改',
        },
      ],
      context: { sessionStage: 'confirm', collectedData: ctx.collectedData },
    };
  }

  private onConfirmation(ctx: SessionContext, action: UIAction): AIUIResponse {
    if (action.payload.type !== 'confirm') {
      return this.buildConfirmation(ctx);
    }
    if (!action.payload.confirmed) {
      ctx.stage = 'fill_detail';
      return this.buildDetailForm(ctx);
    }
    ctx.stage = 'result';
    return this.buildResult(ctx);
  }

  // ====== Stage 4: 展示分析结果 ======

  private buildResult(ctx: SessionContext): AIUIResponse {
    const data = ctx.collectedData;
    const reqTypeLabel = REQ_TYPE_LABELS[String(data.reqType)] ?? '未知类型';
    const reqId = `REQ-${new Date().getFullYear()}-001`;
    return {
      message: '需求已提交并完成初步分析，以下是分析进度与需求详情。',
      components: [
        {
          type: 'steps',
          currentStep: 4,
          steps: [
            { label: '需求提取', status: 'completed' },
            { label: '完整性检查', status: 'completed' },
            { label: '冲突检测', status: 'completed' },
            { label: '复杂度评估', status: 'completed' },
            { label: '汇总报告', status: 'current' },
          ],
        },
        {
          type: 'card',
          title: `需求 ${reqId}`,
          subtitle: String(data.title ?? ''),
          icon: '📊',
          fields: [
            { label: '需求类型', value: reqTypeLabel, type: 'text' },
            { label: '优先级', value: String(data.priority ?? ''), type: 'status' },
            { label: '复杂度评估', value: '中等（预计 8-13 人天）', type: 'text' },
            { label: '状态', value: '待评审', type: 'status' },
          ],
        },
        {
          type: 'action_buttons',
          title: '后续操作',
          buttons: [
            { id: 'gen_story', label: '生成用户故事', icon: '📝', variant: 'primary' },
            { id: 'view_report', label: '查看详细报告', icon: '📄', variant: 'secondary' },
            { id: 'sync_jira', label: '同步到 Jira', icon: '🔗', variant: 'ghost' },
          ],
          layout: 'horizontal',
        },
      ],
      context: { sessionStage: 'result', collectedData: ctx.collectedData },
    };
  }

  // ====== 按钮操作处理 ======

  private handleButtonAction(ctx: SessionContext, action: UIAction): AIUIResponse {
    if (action.payload.type === 'click' && action.payload.actionId === 'new_req') {
      ctx.stage = 'select_type';
      return this.buildSelectType(ctx);
    }
    return {
      message: '操作已收到。',
      components: [{ type: 'text', content: '该操作的后续流程将在后续章节接入。' }],
    };
  }

  private buildRequirementCard(input: string): AIUIResponse {
    const match = input.match(/REQ-[\w-]+/);
    const reqId = match ? match[0] : 'REQ-2024-001';
    return {
      message: '已查询到该需求的详细信息：',
      components: [
        {
          type: 'card',
          title: `需求 ${reqId}`,
          subtitle: '批量导入 Excel 数据',
          icon: '📊',
          fields: [
            { label: '需求状态', value: '待分析', type: 'status' },
            { label: '需求类型', value: '功能需求', type: 'text' },
            { label: '优先级', value: 'P1 - 高', type: 'status' },
          ],
          actions: [
            { id: 'start_analysis', label: '开始分析', variant: 'primary' },
            { id: 'view_similar', label: '查看相似需求', variant: 'secondary' },
          ],
        },
      ],
    };
  }
}
