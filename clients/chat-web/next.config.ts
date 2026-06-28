import type { NextConfig } from "next";
import path from "node:path";

const CHAT_API = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:4001';

const nextConfig: NextConfig = {
  // 产出自包含的 standalone（含最小 server.js + 追踪到的 node_modules），供 Docker 运行时使用
  output: 'standalone',
  // monorepo 显式锁定追踪根为仓库根，确保 standalone 内 server.js 落在 clients/chat-web/server.js
  // （与 Dockerfile.web 的 CMD ["bun", "clients/chat-web/server.js"] 一致，并消除 Next 的根目录推断告警）
  // 用 process.cwd()（turbo/next build 时恒为 clients/chat-web）避免 import.meta 触发 ESM 编译
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  rewrites: async () => [
    {
      source: '/api/sse/:path*',
      destination: `${CHAT_API}/api/sse/:path*`,
    },
  ],
};

export default nextConfig;
