import { z } from 'zod';

export const APP_NAME = "llm";

export const RequirementSchema = z.object({
  input: z.string().min(1),
});

export const RequirementResultSchema = z.object({
  action: z.string().describe('唯一核心动作'),
  constraints: z.array(z.string()).describe('明确约束条件'),
  entities: z.array(z.string()).describe('关键实体'),
});

export type RequirementResult = z.infer<typeof RequirementResultSchema>;
