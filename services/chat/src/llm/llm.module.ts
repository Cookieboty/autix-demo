import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { OrchestratorService } from './agents/orchestrator.service';
import { ModelConfigModule } from '../model-config/model-config.module';
import { UIResponseService } from './ui-protocol/ui-response.service';
import { TokenUsageService } from './cost/token-usage.service';
import { CostController } from './cost/cost.controller';
import { PrismaService } from '../prisma/prisma.service';

// 16.4：把第十章的 Token 计量服务接进 DI（此前从未注册）。
// 构造需要 PrismaClient；PrismaService 是全局模块导出的 PrismaClient 子类。
const tokenUsageProvider = {
  provide: TokenUsageService,
  useFactory: (prisma: PrismaService) => new TokenUsageService(prisma),
  inject: [PrismaService],
};

@Module({
  imports: [ModelConfigModule],
  controllers: [CostController],
  providers: [LlmService, OrchestratorService, UIResponseService, tokenUsageProvider],
  exports: [LlmService, OrchestratorService, UIResponseService, TokenUsageService],
})
export class LlmModule {}
