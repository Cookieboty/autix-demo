import { createAnalysisGraph } from './requirement-analysis-graph';
import { createChatModel } from '../model.factory';

async function testMultiAgent() {
  const model = createChatModel({
    modelConfigId: 'test-multi-agent',
    modelName: process.env.OPENAI_MODEL || 'gpt-5.5',
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
  });

  const graph = createAnalysisGraph(model);

  const testCases = [
    {
      name: '单专家场景：简单文案修改',
      input: '需求：将登录页的"登录"按钮文案改为"立即登录"',
      expectedExperts: ['functional'],
    },
    {
      name: '双专家场景：功能+性能',
      input: '需求 REQ-20240315-001：支持批量导入 Excel 用户数据，单次最多 10000 行',
      expectedExperts: ['functional', 'performance'],
    },
    {
      name: '三专家场景：功能+性能+安全',
      input: '需求：新增用户敏感数据导出功能，支持导出用户手机号和身份证信息',
      expectedExperts: ['functional', 'performance', 'security'],
    },
    {
      name: '四专家全开：复杂的金融场景',
      input: '需求：开发跨境支付功能，支持欧盟和中国用户，涉及个人金融信息处理',
      expectedExperts: ['functional', 'performance', 'security', 'compliance'],
    },
    {
      name: '边界场景：模糊需求',
      input: '需求：优化系统',
      expectedExperts: [], // 期望 supervisor 至少选一个
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`测试用例：${testCase.name}`);
    console.log(`输入：${testCase.input}`);
    console.log(`期望专家：${testCase.expectedExperts.join(', ') || '至少一个'}`);
    console.log(`${'='.repeat(60)}\n`);

    const startTime = Date.now();

    try {
      const result = await graph.invoke(
        {
          input: testCase.input,
          messages: [],
        },
      );

      const elapsedTime = Date.now() - startTime;

      console.log(`\n✓ 执行成功 (耗时:${elapsedTime}ms)`);
      console.log(`实际选中的专家：${result.activeExperts?.join(', ') || '无'}`);

      // 检查每个专家的输出
      if (result.activeExperts) {
        for (const expert of result.activeExperts) {
          const outputField = `${expert}Analysis`;
          const output = (result as any)[outputField];
          console.log(`\n【${expert} 专家输出】（${output?.length || 0} 字符）`);
          console.log(output?.substring(0, 200) + (output?.length > 200 ? '...' : ''));
        }
      }

      // 检查汇总结果
      console.log(`\n【汇总结果】（${result.analysisResult?.length || 0} 字符）`);
      console.log(result.analysisResult?.substring(0, 300) + '...');

      // 验证并行执行（如果有多个专家）
      if (result.activeExperts && result.activeExperts.length > 1) {
        const avgTimePerExpert = elapsedTime / result.activeExperts.length;
        console.log(`\n⚡ 并行效果：平均每专家${avgTimePerExpert.toFixed(0)}ms`);
        console.log(`   （串行预估：${(elapsedTime / result.activeExperts.length * result.activeExperts.length).toFixed(0)}ms）`);
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`\n✗ 执行失败：${err.message}`);
      console.error(err.stack);
    }
  }
}

testMultiAgent().catch(console.error);