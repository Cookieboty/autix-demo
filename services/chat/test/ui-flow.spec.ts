import { describe, it, expect } from 'bun:test';
import { UIFlowService } from '../src/llm/ui-protocol/ui-flow.service';
import type { UIAction } from '../src/llm/ui-protocol/ui-types';

// 确定性状态机，无 LLM 调用，可直接断言完整交互闭环（对应 6.3 验证步骤）。
describe('UIFlowService 交互闭环', () => {
  const sessionId = 'spec-session';

  it('依次推进 select_type → form → confirmation → result', () => {
    const flow = new UIFlowService();

    // Stage 1: 自然语言触发需求流程 → selection
    const s1 = flow.handleInput(sessionId, '我要提一个新需求：批量导入 Excel 数据');
    expect(s1.components[0].type).toBe('selection');
    if (s1.components[0].type === 'selection') {
      expect(s1.components[0].options.length).toBe(4);
    }

    // Stage 2: 选择需求类型 → form
    const selectAction: UIAction = {
      componentType: 'selection',
      payload: { type: 'select', selectedId: 'functional' },
    };
    const s2 = flow.handleAction(sessionId, selectAction);
    expect(s2.components[0].type).toBe('form');
    if (s2.components[0].type === 'form') {
      expect(s2.components[0].fields.length).toBe(5);
    }

    // Stage 3: 提交表单 → confirmation
    const submitAction: UIAction = {
      componentType: 'form',
      payload: {
        type: 'submit',
        formData: { title: '批量导入 Excel 数据', description: '支持 xlsx/csv', priority: 'P1' },
      },
    };
    const s3 = flow.handleAction(sessionId, submitAction);
    expect(s3.components[0].type).toBe('confirmation');
    if (s3.components[0].type === 'confirmation') {
      expect(JSON.stringify(s3.components[0].summary)).toContain('批量导入 Excel 数据');
    }

    // Stage 4: 确认 → steps + card + action_buttons
    const confirmAction: UIAction = {
      componentType: 'confirmation',
      payload: { type: 'confirm', confirmed: true },
    };
    const s4 = flow.handleAction(sessionId, confirmAction);
    const types = s4.components.map((c) => c.type);
    expect(types).toEqual(['steps', 'card', 'action_buttons']);
  });

  it('确认对话框点击取消时回退到 fill_detail', () => {
    const flow = new UIFlowService();
    const sid = 'spec-cancel';
    flow.handleInput(sid, '我要提一个新需求');
    flow.handleAction(sid, { componentType: 'selection', payload: { type: 'select', selectedId: 'functional' } });
    flow.handleAction(sid, { componentType: 'form', payload: { type: 'submit', formData: { title: 't' } } });

    const back = flow.handleAction(sid, {
      componentType: 'confirmation',
      payload: { type: 'confirm', confirmed: false },
    });
    expect(back.components[0].type).toBe('form');
  });
});
