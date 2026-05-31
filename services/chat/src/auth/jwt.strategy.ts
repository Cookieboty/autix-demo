import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { assertSessionAlive, noopSessionStore, type SessionStore } from '../security/session-check';

/**
 * query token 只对 SSE 类路由开放（EventSource 不能自定义 Header，只能 ?token=）。
 * 其他路由接受 query token 是过度开放——token 会进 access 日志/Referer/历史（18.2.1）。
 */
function isSseRoute(req: Request): boolean {
  const path = req.path || (req as any).url || '';
  return path.includes('/sse') || path.endsWith('/chat');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * 会话吊销校验来源。chat 与 user-system 是独立库，默认 no-op（放行）；
   * 生产可注入连 user_system 库或调 HTTP 的实现（见 security/session-check.ts）。
   */
  private readonly sessionStore: SessionStore = noopSessionStore;

  constructor() {
    super({
      jwtFromRequest: (req: Request) => {
        // 1. Authorization: Bearer <token>
        const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        if (fromHeader) return fromHeader;

        // 2. Cookie 方式（用于 SSE 等无法设置 Header 的场景）
        const cookie = req.headers.cookie ?? '';
        const match = cookie.match(/accessToken=([^;]+)/);
        if (match) return match[1];

        // 3. Query parameter —— 仅 SSE 类路由（18.2.2 收紧）
        const queryToken = req.query.token;
        if (typeof queryToken === 'string' && isSseRoute(req)) return queryToken;

        return null;
      },
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: any) {
    // 会话吊销校验（默认 no-op；注入真实 store 后可让 user-system 登出对 chat 即时生效）
    await assertSessionAlive(this.sessionStore, payload.sessionId);
    return {
      userId: payload.sub,
      username: payload.username,
      sessionId: payload.sessionId,
    };
  }
}
