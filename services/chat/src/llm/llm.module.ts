import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';
import { RequirementService } from './requirement.service';
import { OrchestratorService } from './agents/orchestrator.service';

@Module({
  providers: [LlmService, RequirementService, OrchestratorService],
  controllers: [LlmController],
  exports: [LlmService, RequirementService, OrchestratorService],
})
export class LlmModule {}
