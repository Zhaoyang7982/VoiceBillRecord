import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const reqPath = join(repoRoot, '需求文档.md');

describe('repo harness', () => {
  it('需求文档存在且包含 Neon 数据层约定', () => {
    expect(existsSync(reqPath)).toBe(true);
    const text = readFileSync(reqPath, 'utf8');
    expect(text).toContain('Neon');
    expect(text).toContain('Serverless');
  });

  it('Agent 入口与检查清单存在', () => {
    expect(existsSync(join(repoRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(repoRoot, 'docs', 'AGENT_CHECKLIST.md'))).toBe(true);
  });

  it('环境变量模板与项目安全说明存在', () => {
    expect(existsSync(join(repoRoot, '.env.example'))).toBe(true);
    expect(existsSync(join(repoRoot, 'docs', '环境变量与密钥.md'))).toBe(true);
  });
});
