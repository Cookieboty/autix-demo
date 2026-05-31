/**
 * cost.controller.ts
 *
 * 16.4.3：把第十章的 Token 计量聚合暴露成只读查询入口。
 * 跑通主链路（或 demo）后，GET /api/cost/summary 能看到本月各节点/各 Agent 烧了多少 token。
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TokenUsageService } from './token-usage.service';

@Controller('api/cost')
@UseGuards(JwtAuthGuard)
export class CostController {
  constructor(private readonly usage: TokenUsageService) {}

  @Get('summary')
  async summary() {
    // TokenUsageService 已有的聚合方法（无需新增）
    const [monthly, byNode, byAgent] = await Promise.all([
      this.usage.getMonthlyStats(),
      this.usage.getStatsByNode(),
      this.usage.getStatsByAgent(),
    ]);
    return { monthly, byNode, byAgent };
  }
}
