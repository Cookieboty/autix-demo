import { Module } from '@nestjs/common';
import { RunnableMemoryService } from './memory/runnable-memory.service';
import { FilesystemService } from './filesystem/filesystem.service';
import { EmbeddingService } from './embedding/embedding.service';
import { VectorStoreService } from './embedding/vector-store.service';
import { OrchestratorService } from './agents/orchestrator.service';
import { AdvancedAnalysisService } from './advanced-analysis.service';
import {
  MemoryController,
  FilesystemController,
  EmbeddingController,
  AgentsController,
  AdvancedController,
} from './advanced.controller';

@Module({
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    AdvancedController,
  ],
  providers: [
    RunnableMemoryService,
    FilesystemService,
    EmbeddingService,
    VectorStoreService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
})
export class AdvancedModule {}
