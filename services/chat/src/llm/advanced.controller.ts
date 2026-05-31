import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RunnableMemoryService } from './memory/runnable-memory.service';
import { FilesystemService } from './filesystem/filesystem.service';
import { EmbeddingService } from './embedding/embedding.service';
import { VectorStoreService } from './embedding/vector-store.service';
import { OrchestratorService } from './agents/orchestrator.service';
import { AdvancedAnalysisService } from './advanced-analysis.service';

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memory: RunnableMemoryService) {}

  @Post('chat')
  chat(@Body() body: { sessionId: string; input: string }) {
    return this.memory.chat(body.sessionId, body.input);
  }

  @Get('history/:sessionId')
  history(@Param('sessionId') sessionId: string) {
    return this.memory.getHistory(sessionId);
  }

  @Delete('history/:sessionId')
  clear(@Param('sessionId') sessionId: string) {
    this.memory.clearSession(sessionId);
    return { cleared: true };
  }
}

@Controller('api/files')
export class FilesystemController {
  constructor(private readonly filesystem: FilesystemService) {}

  @Post('chat')
  chat(@Body() body: { input: string }) {
    return this.filesystem.chat(body.input);
  }
}

@Controller('api/embedding')
export class EmbeddingController {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly vectorStore: VectorStoreService
  ) {}

  @Post('embed')
  async embed(@Body() body: { text: string }) {
    const vector = await this.embedding.embedQuery(body.text);
    return { dimension: vector.length, vector };
  }

  @Post('store')
  store(@Body() body: { texts: string[] }) {
    return this.vectorStore.addTexts(body.texts);
  }

  @Post('search')
  search(@Body() body: { query: string; k?: number }) {
    return this.vectorStore.search(body.query, body.k);
  }
}

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('orchestrate')
  orchestrate(@Body() body: { input: string }) {
    return this.orchestrator.orchestrate(body.input);
  }
}

@Controller('api/advanced')
export class AdvancedController {
  constructor(private readonly advanced: AdvancedAnalysisService) {}

  @Post('analyze')
  analyze(@Body() body: { sessionId: string; input: string }) {
    return this.advanced.analyze(body.sessionId, body.input);
  }
}
