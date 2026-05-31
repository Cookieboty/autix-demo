import { Injectable } from "@nestjs/common";
import { APP_NAME } from "@autix/contracts";
import { PrismaService } from "./prisma/prisma.service";

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): { message: string } {
    return { message: `Hello from Chat, shared APP_NAME=${APP_NAME}` };
  }

  // liveness：进程还活着吗（不探依赖）
  getHealth(): { ok: boolean } {
    return { ok: true };
  }

  // readiness：服务能干活吗（真探 DB）。16.5.2
  async getReadiness(): Promise<{ ready: boolean; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch (e) {
      checks.db = "fail: " + String(e).slice(0, 80);
    }
    // LLM 网关探测属于外部弱依赖，默认不探（见 16.11 Q5），避免拖慢健康检查
    const ready = Object.values(checks).every((v) => v === "ok");
    return { ready, checks };
  }
}
