import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationService } from './conversation.service';
import { MessageService } from '../message/message.service';
import { AdvancedAnalysisService } from '../llm/advanced-analysis.service';

@UseGuards(JwtAuthGuard)
@Controller('api/conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly advancedAnalysis: AdvancedAnalysisService
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() body: { title?: string }) {
    const userId = (req.user as any).userId;
    return this.conversationService.create(userId, body.title);
  }

  @Get()
  async findAll(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.conversationService.findByUser(userId);
  }

  @Get(':id/messages')
  async getMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limit?: string
  ) {
    const userId = (req.user as any).userId;
    await this.conversationService.findById(id, userId);
    const parsed = limit ? parseInt(limit, 10) : undefined;
    const safeLimit = parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return this.messageService.getHistory(id, safeLimit);
  }

  // RAG + 多 Agent 分析，结果落库（非流式，第六章再升级为流式 UI）
  @Post(':id/chat')
  async chat(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { input: string }
  ) {
    const userId = (req.user as any).userId;
    await this.conversationService.findById(id, userId);
    return this.advancedAnalysis.analyze(userId, id, body.input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as any).userId;
    await this.conversationService.delete(id, userId);
  }
}
