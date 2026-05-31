import type { NextConfig } from "next";

const CHAT_API = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:4001';

const nextConfig: NextConfig = {
  // 产出自包含的 standalone（含最小 server.js + 追踪到的 node_modules），供 Docker 运行时使用
  output: 'standalone',
  rewrites: async () => [
    {
      source: '/api/sse/:path*',
      destination: `${CHAT_API}/api/sse/:path*`,
    },
  ],
};

export default nextConfig;
