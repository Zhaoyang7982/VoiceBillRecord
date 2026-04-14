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
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8');
    expect(envExample).toContain('DEEPSEEK_API_KEY');
    expect(envExample).toContain('DATABASE_URL');
  });

  it('本地开发环境备忘存在', () => {
    expect(existsSync(join(repoRoot, 'docs', '本地开发环境.md'))).toBe(true);
  });

  it('Vercel 与 CORS 部署说明存在', () => {
    expect(existsSync(join(repoRoot, 'docs', 'Vercel部署与CORS.md'))).toBe(true);
  });

  it('GitHub Pages 部署工作流存在', () => {
    expect(existsSync(join(repoRoot, '.github', 'workflows', 'pages.yml'))).toBe(true);
  });

  it('MVP 静态页与 Serverless 路由文件存在', () => {
    expect(existsSync(join(repoRoot, 'public', 'index.html'))).toBe(true);
    expect(existsSync(join(repoRoot, 'public', 'app.js'))).toBe(true);
    expect(existsSync(join(repoRoot, 'public', 'styles.css'))).toBe(true);
    expect(existsSync(join(repoRoot, 'api', 'parse.js'))).toBe(true);
    expect(existsSync(join(repoRoot, 'api', 'expenses.js'))).toBe(true);
    expect(existsSync(join(repoRoot, 'db', 'schema.sql'))).toBe(true);
    expect(existsSync(join(repoRoot, 'lib', 'api-http.js'))).toBe(true);
  });
});

describe('需求文档十（集成测试占位）', () => {
  it.todo('口语金额：二十六块、26元、26.5 等映射正确');
  it.todo('无金额语句：模型返回 amount null，前端提示且拒绝写库');
  it.todo('商户名、方言样例：分类与 shop 合理');
  it.todo('网络异常与 AI 非 JSON：用户可见错误且不白屏');
  it.todo('API / 数据库写入失败：首页/列表可见错误提示');
});
