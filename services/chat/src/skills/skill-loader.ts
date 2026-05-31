/**
 * skill-loader.ts —— 第二十章 20.5：把第十三章的 SKILL.md「方法论」加载进运行时。
 *
 * 第十三章把需求分析方法论沉淀成了 src/skills/definitions/<name>/SKILL.md（带 YAML frontmatter
 * + Markdown 正文），但只在 scripts/test 用过，主链路没有任何加载器。这里补一个最小加载器：
 * 读 SKILL.md → 解析 frontmatter → 返回正文（方法论），供 orchestrator 注入分析 prompt。
 *
 * 找不到/读不了返回 null（主链路照常，不注入）——SKILL.md 是 .md 非编译产物，生产镜像需在
 * 第二十章 20.8 的 infra 里一并拷贝，本加载器在缺失时优雅降级。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface LoadedSkill {
  name: string;
  description?: string;
  /** SKILL.md 的 Markdown 正文（方法论本体），注入到分析 system 上下文。 */
  content: string;
}

function skillPath(name: string): string {
  return path.resolve(
    process.cwd(),
    'src',
    'skills',
    'definitions',
    name,
    'SKILL.md',
  );
}

/** 加载指定 skill；返回 null 表示不可用（主链路不注入方法论，照常运行）。 */
export function loadSkill(name: string): LoadedSkill | null {
  try {
    const raw = fs.readFileSync(skillPath(name), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { name, content: raw.trim() };
    const meta = (yaml.load(m[1]) ?? {}) as {
      name?: string;
      description?: string;
    };
    return {
      name: meta.name ?? name,
      description: meta.description,
      content: m[2].trim(),
    };
  } catch {
    return null;
  }
}
