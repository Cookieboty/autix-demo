import { describe, it, expect } from 'bun:test';
import { RequirementService } from '../src/llm/requirement.service';

// 该用例会发起真实模型调用（耗时且依赖外部服务），默认跳过。
// 需要端到端验证时显式开启：RUN_LLM_E2E=1 bun test
const runIf = process.env.RUN_LLM_E2E ? it : it.skip;

describe('Requirement Extract', () => {
  runIf(
    'should extract correctly',
    async () => {
      const service = new RequirementService();
      const result = await service.extract(
        '用户注册时必须绑定手机号，密码至少8位'
      );

      // 结构化输出契约：字段类型稳定（这是 withStructuredOutput 的核心保证）
      expect(typeof result.action).toBe('string');
      expect(result.action.length).toBeGreaterThan(0);
      expect(Array.isArray(result.constraints)).toBe(true);
      expect(Array.isArray(result.entities)).toBe(true);
      expect(result.constraints.length).toBeGreaterThan(0);
      // 输入中明确出现"手机号"，应在抽取结果中有所体现（LLM 措辞可能不同，故只断言语义命中）
      expect(JSON.stringify(result)).toContain('手机号');
    },
    30000
  );
});
