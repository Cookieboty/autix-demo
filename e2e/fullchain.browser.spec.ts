import { expect, test } from '@playwright/test';

const RUN_BROWSER_E2E = process.env.RUN_BROWSER_E2E === '1';
const CHAT_API_URL = process.env.E2E_CHAT_API_URL ?? 'http://localhost:4001';
const USERNAME = process.env.E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin@123456';
const REPORT_TERMS = /企业微信|OAuth2|授权码|corpId|扫码登录|安全风险|验收标准/i;
// 关键步骤截图目录（可用 E2E_SHOTS_DIR 覆盖）。Playwright 会按需创建中间目录。
// 默认写进 docs/images/ch20，供第二十章直接引用。
const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? 'docs/images/ch20';

function unwrapData<T>(body: T | { data?: T }): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data?: T }).data as T;
  }
  return body as T;
}

test.describe('Chapter 20 full-chain browser E2E', () => {
  test.skip(!RUN_BROWSER_E2E, 'Set RUN_BROWSER_E2E=1 after starting user-system, chat, and chat-web.');

  test('login -> ChatView -> SSE -> Controller -> DB -> Artifact -> browser assert', async ({
    page,
    request,
  }) => {
    const ready = await request.get(`${CHAT_API_URL}/ready`);
    expect(ready.ok(), '/ready should be healthy before browser flow starts').toBeTruthy();

    const smokePrompt = [
      '为后台管理系统增加企业微信扫码登录。',
      '要求：使用 OAuth2 授权码模式，回调时校验 corpId，自动绑定已有账号。',
      '请输出需求分析报告，并特别说明安全风险与验收标准。',
    ].join('\n');

    await page.goto('/login');
    await page.getByLabel('账号').fill(USERNAME);
    await page.getByLabel('密码').fill(PASSWORD);
    await page.screenshot({ path: `${SHOTS_DIR}/01-login.png` });
    await page.getByRole('button', { name: /开始对话/ }).click();

    await expect(page).toHaveURL(/\/c\/[^/]+$/);
    await expect(page.getByText('Chat workspace')).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/02-workspace.png` });

    const token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token, 'login should store JWT accessToken').toBeTruthy();

    // 测试自我隔离：用同一个 JWT 新建一个空会话并导航进去，避免 ChatView 默认加载到
    // 历史会话（可能已带旧 artifact）导致面板"秒出"的假阳性。这样断言的就是本次链路的新产物。
    const authHeaders = { Authorization: `Bearer ${token}` };
    const freshConv = await request.post(`${CHAT_API_URL}/api/conversations`, {
      headers: authHeaders,
      data: { title: `e2e-fullchain-${Date.now()}` },
    });
    expect(freshConv.ok(), 'should create a fresh conversation for the run').toBeTruthy();
    const freshId = unwrapData<{ id: string }>(await freshConv.json()).id;
    expect(freshId, 'fresh conversation should have an id').toBeTruthy();
    await page.goto(`/c/${freshId}`);
    await expect(page).toHaveURL(new RegExp(`/c/${freshId}$`));

    await page.getByLabel('消息输入框').fill(smokePrompt);
    const chatResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/conversations/') &&
        response.url().endsWith('/chat'),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: '发送消息' }).click();
    const chatResponse = await chatResponsePromise;

    // 确认用户消息已渲染成气泡。匹配提示词独有的开头（会话标题/侧边栏不含这串前缀），
    // 并用 .first() 兜底，避免 getByText 在多处子串命中时触发 strict mode 冲突。
    await expect(
      page.getByText('为后台管理系统增加企业微信扫码登录').first(),
    ).toBeVisible();
    expect(chatResponse.status(), 'ChatView should post through the SSE controller').toBe(200);
    // 发送后：用户气泡 + ThinkingIndicator 正在流式分析
    await page.screenshot({ path: `${SHOTS_DIR}/03-streaming.png` });

    const conversationId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
    expect(conversationId, 'browser URL should contain the active conversation id').toBeTruthy();

    // 满血链路要等真实 LLM 全图（含 Critic-Refine 循环）跑到 summaryAgent 完成、后端 upsertArtifact、
    // 再经 artifact_created SSE 事件加载面板。实测慢推理模型（gpt-5.4）下一条短任务约 380s 到达
    // artifact，故给到 9 分钟余量（Layer 3 本就是 release gate，不进每次 PR）。
    await expect(page.locator('#artifact-panel')).toBeVisible({ timeout: 540_000 });
    await expect(page.locator('#artifact-panel')).toContainText(REPORT_TERMS);
    // 满血链路终态：左侧对话 + 右侧 ArtifactPanel 渲染出需求分析报告（整页截图存证）
    await page.screenshot({ path: `${SHOTS_DIR}/04-artifact.png`, fullPage: true });

    const messages = await request.get(
      `${CHAT_API_URL}/api/conversations/${conversationId}/messages`,
      { headers: authHeaders },
    );
    expect(messages.ok(), 'messages endpoint should be readable with the same JWT').toBeTruthy();
    const messageRows = unwrapData<Array<{ role: string; content: string }>>(await messages.json());
    expect(
      messageRows.some((m) => m.role === 'USER' && m.content.includes('企业微信')),
      'user message should be persisted',
    ).toBeTruthy();
    expect(
      messageRows.some((m) => m.role === 'ASSISTANT' && m.content.length > 100),
      'assistant report should be persisted',
    ).toBeTruthy();

    const artifact = await request.get(
      `${CHAT_API_URL}/api/artifacts/conversation/${conversationId}`,
      { headers: authHeaders },
    );
    expect(artifact.ok(), 'artifact should be persisted for the conversation').toBeTruthy();
    const artifactBody = unwrapData<{ content?: string; currentVersion?: number } | null>(
      await artifact.json(),
    );
    expect(artifactBody?.content?.length ?? 0, 'artifact content should be non-empty').toBeGreaterThan(100);
    expect(artifactBody?.content ?? '').toMatch(REPORT_TERMS);
    expect(artifactBody?.currentVersion, 'artifact should have a persisted version').toBeGreaterThanOrEqual(1);

    const cost = await request.get(`${CHAT_API_URL}/api/cost/summary`, {
      headers: authHeaders,
    });
    expect(cost.ok(), 'cost summary should be available after a full-chain request').toBeTruthy();
    const costBody = unwrapData<Record<string, unknown>>(await cost.json());
    expect(costBody, 'cost summary should return a JSON object').toBeTruthy();

    const metrics = await request.get(`${CHAT_API_URL}/metrics`);
    expect(metrics.ok(), '/metrics should be exposed for deployment smoke checks').toBeTruthy();
    expect(await metrics.text()).toContain('# HELP');
  });
});
