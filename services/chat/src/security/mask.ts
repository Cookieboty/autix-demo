/**
 * mask.ts —— 密钥脱敏（第十八章 18.7.1）。
 *
 * 用于 API 返回层：前端展示 `sk-1***def0` 足够辨认是哪个 key，但拿不到完整值。
 * 注意：这是「返回脱敏」，不是「加密存储」——库里仍是明文，加密存储是下一步（数据迁移）。
 */
export function maskSecret(v?: string | null): string {
  if (!v) return '';
  if (v.length <= 8) return '***';
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
}

/** 对一个模型配置对象的 apiKey 字段做脱敏，返回新对象（不改原对象） */
export function maskApiKey<T extends { apiKey?: string | null }>(record: T): T {
  return { ...record, apiKey: maskSecret(record.apiKey) };
}
