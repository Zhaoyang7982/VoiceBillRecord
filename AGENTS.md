# VoiceBillRecord — Agent 入口（Harness）

## 项目一句话

极简 **语音记账** Web 应用：浏览器 **Web Speech API** 转文字 → 大模型解析为结构化 JSON → 经 **Serverless API** 写入 **Neon（Postgres）**。完整产品与约束见 [需求文档.md](./需求文档.md)。

## 阅读顺序（执行任务前）

1. [需求文档.md](./需求文档.md) — 功能范围、技术栈、API 形态、安全与部署原则。
2. [docs/AGENT_CHECKLIST.md](./docs/AGENT_CHECKLIST.md) — 分阶段可勾选清单与完成定义（DoD）。
3. [docs/本地开发环境.md](./docs/本地开发环境.md) — Node/npm 与项目依赖的关系、`npm install`/`npm test`、镜像与 PATH 备忘。

修改行为或交付物时，应能回指上述文档中的章节；不要引入与需求文档矛盾的密钥或架构。

## 技术栈摘要

- 前端：HTML / CSS / 原生 JS（或后续可选框架）。
- STT：Web Speech API（`zh-CN`）。
- AI：任意支持 HTTP 的模型 API；**推荐**经 serverless 代理，不把高权限 Key 暴露给浏览器。
- 数据：**Neon** + 自建 HTTP API（如 `POST/GET /api/expenses`）；浏览器**不**直连数据库、**不**持有 `DATABASE_URL`。

## 禁区（必须遵守）

- 勿将 **`DATABASE_URL`**、**大模型主 Key**、**仅服务端可用的 Bearer** 写入前端源码、静态构建产物或公开仓库。
- 个人项目若使用前端可调用的网关口令（见 [`.env.example`](./.env.example) 中 `API_GATE_TOKEN`），需明确其为「低权限、可轮换」，且仍优先同域 + HTTPS。

**环境变量模板与更细的安全分层**：见 [docs/环境变量与密钥.md](./docs/环境变量与密钥.md)；可复制根目录 [`.env.example`](./.env.example) 为本地 `.env`（`.env` 已被 git 忽略）。

## 建议目录（代码落地后）

以下为约定式结构，可按实现微调，但应在 PR 中说明：

- `public/` 或 `web/` — 静态页面（Home / List / Stats）。
- `api/` 或 Vercel `api/` — Serverless 路由（解析、读写 expenses）。

## 本地与 CI

**从零到能跑测试**：详见 [docs/本地开发环境.md](./docs/本地开发环境.md)（要点：`brew install node` 为**全机**安装；本仓库需再执行 **`npm install` + `npm test`**；国内网络见镜像文档）。

### 国内网络（可选）

若 `brew` / `npm` 访问 GitHub 较慢，可在本机按 [docs/国内镜像配置.md](./docs/国内镜像配置.md) 配置清华 Homebrew 与 npmmirror（修改 `~/.zshrc` / `~/.npmrc` 后需新开终端或 `source ~/.zshrc`）。

### 日常命令

- 安装依赖：`npm install`；若已提交 `package-lock.json`，推荐使用 `npm ci`。
- 运行测试：`npm test`（Vitest，含仓库健康类冒烟断言）。
- 合并或发布前：勾选 [docs/AGENT_CHECKLIST.md](./docs/AGENT_CHECKLIST.md) 中与本次改动相关的阶段；CI 工作流：`.github/workflows/ci.yml`（`ci`）。

## 任务终止条件

- 相关清单项已勾选或已注明「不适用」理由。
- `npm test` 通过；若已连接远程仓库，推送后 CI 为绿。
- 未新增未文档化的密钥模式或越权数据访问路径。
