# autix — 工程底座（第二章）

用 Bun workspaces 搭建的可扩展 monorepo，工程分三层：

- `clients/`：客户端应用（Next.js）
- `services/`：服务进程（NestJS）
- `packages/`：跨层复用的共享包

本分支（`feat/foundation`）对应《第二章：搭建智能体的工程底座》，只包含"能跑起来"的最小工程：

- `packages/contracts`：共享包（导出 `APP_NAME`）
- `services/chat`：Nest API，提供 `GET /health` 与 `GET /hello`（端口 4001）
- `clients/chat-web`：Next Web，页面渲染 + 调用 API（端口 3002）
- `infra/compose`：Docker Compose，一条命令启动 chat + chat-web

## 技术栈

Bun（runtime + 包管理 + workspaces）、Turbo（任务编排 + 缓存）、Next.js、NestJS、Docker Compose。

## 快速开始

```bash
bun install
bun run build      # @autix/contracts 先构建
bun run dev        # 同时启动 chat(4001) 与 chat-web(3002)
```

验收：

- 打开 `http://localhost:3002`，点击「调用 API」，页面显示 API 返回的 message
- `curl http://localhost:4001/health` 返回 `{ "ok": true }`
- `curl http://localhost:4001/hello` 返回 `Hello from Chat, shared APP_NAME=llm`
