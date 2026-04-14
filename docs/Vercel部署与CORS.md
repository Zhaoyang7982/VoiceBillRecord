# Vercel 部署 + 环境变量 + CORS_ORIGIN（操作指南）

本文对应上线自检 [AGENT_CHECKLIST.md](./AGENT_CHECKLIST.md) 的 **E3**，与 [环境变量与密钥.md](./环境变量与密钥.md) 一致：**密钥只放在 Vercel 环境变量**，不要写进 GitHub 仓库或前端源码。

### 首次发布 GitHub Pages（本仓库）

1. 仓库 **Settings → Pages**：**Build and deployment → Source** 选 **GitHub Actions**（不要选错成 Branch 而未配工作流）。  
2. 将 `main` 推送到 GitHub：工作流 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) 会自动把 **`public/`** 部署为站点。  
3. 首次使用 `deploy-pages` 时，若 Actions 提示等待 **Environment** 批准：打开 **Settings → Environments → github-pages**，按需关闭「Required reviewers」或批准一次运行。  
4. 项目站地址一般为：`https://<用户名>.github.io/VoiceBillRecord/`（以 Pages 设置页顶部提示为准）。静态资源使用**相对路径**，避免子路径下 CSS/JS 404。

---

## 整体图景

| 位置 | 托管内容 | 域名示例 |
|------|----------|----------|
| **GitHub Pages** | 静态页（`public/`） | `https://你的用户名.github.io`（项目页路径在地址栏里可能有 `/仓库名/`，但浏览器请求头里的 **Origin 仍是 `https://你的用户名.github.io`**，不含路径） |
| **Vercel** | Serverless **API**（`api/parse.js`、`api/expenses.js`） | `https://某项目.vercel.app` |

从 Pages 打开的网页里，`fetch` 会请求 Vercel 域名 → **跨域**。浏览器会检查响应里的 **CORS**；服务端通过环境变量 **`CORS_ORIGIN`** 与 [`lib/api-http.js`](../lib/api-http.js) 中的 `getCorsHeaders` 返回允许的 `Access-Control-Allow-Origin`。

---

## 第一步：把代码推到 GitHub，并在 Vercel 导入项目

1. 本地仓库已提交并 **push** 到 GitHub（默认分支如 `main`）。
2. 打开 [vercel.com](https://vercel.com)，使用 **GitHub** 登录。
3. **Add New → Project**，选中 **VoiceBillRecord** 仓库。
4. **Framework Preset** 选 **Other** 或保持自动检测即可。
5. 点击 **Deploy**，等待 **Ready**。
6. 在项目 **Overview** 记下 **Production URL**（例如 `https://voicebillrecord-xxx.vercel.app`），供下一步「API 根地址」使用。

---

## 第二步：在 Vercel 配置环境变量并 Redeploy

路径：**Project → Settings → Environment Variables**。

逐条 **Add**（名称区分大小写），**Value** 从 Neon / DeepSeek 控制台复制；**Environment** 至少勾选 **Production**（需要预览环境时再勾 Preview）。

| 变量名 | 含义 |
|--------|------|
| `DATABASE_URL` | Neon 控制台 **Connection string**（完整 `postgresql://...?sslmode=require`） |
| `DEEPSEEK_API_KEY` | [DeepSeek 平台](https://platform.deepseek.com/api_keys) 申请的 API Key |
| `CORS_ORIGIN` | 见下一节；**Pages 与 API 不同域时强烈建议必填** |
| `DEEPSEEK_API_URL` | 可选；默认 `https://api.deepseek.com`，见根目录 `.env.example` |
| `DEEPSEEK_MODEL` | 可选；默认 `deepseek-chat` |
| `API_GATE_TOKEN` | 可选；启用后前端「门令」须填同一串 |

保存后务必 **Redeploy**：**Deployments** → 最新一条右侧 **⋯** → **Redeploy**，否则线上函数可能仍用旧环境。

---

## 第三步：正确填写 `CORS_ORIGIN`

- **含义**：允许从哪些 **网页源（Origin）** 跨域调用你的 API。
- **格式**：`协议 + 主机 + 端口`，**不要**带页面路径；多个源用 **英文逗号** 分隔，例如：  
  `https://你的用户名.github.io,http://localhost:3000`
- **如何抄得一字不差**：用浏览器打开 **GitHub Pages 上的记账页** → **F12 → Network** → 点任意一条发往 `vercel.app` 的请求 → **Request Headers → Origin**，把该值粘贴到 Vercel 的 `CORS_ORIGIN`。

若填错：控制台会出现 **CORS** 报错，`fetch` 失败（与 DeepSeek、Neon 是否正常无关）。

服务端逻辑：仅当请求的 `Origin` 在白名单内时，才会返回与之匹配的 `Access-Control-Allow-Origin`；**不在名单内的跨域请求不会误用白名单第一项**（见 `lib/api-http.js`）。

---

## 第四步：前端「API 根地址」与 Pages 对齐

在 **GitHub Pages** 打开的站点中：

1. 展开 **可选设置**；
2. **API 根地址** 填第二步记下的 Vercel Production URL（`https://xxx.vercel.app`，无尾斜杠）；
3. 点 **保存 API 地址**（写入本机 `localStorage`，换设备需重填）。

或在构建前修改 [`public/index.html`](../public/index.html) 中的 `window.VBR_API_BASE_URL` 为同一地址（适合固定域名发布）。

---

## 第五步：验证是否成功

1. Vercel **Deployments** 为 **Ready**。  
2. 新标签访问：`https://你的.vercel.app/api/expenses`  
   - 未启用 `API_GATE_TOKEN` 时应返回 JSON（可能含空列表）；  
   - 启用门限时未带 Bearer 可能为 **401**，属正常。  
3. 从 **Pages 域名** 打开记账页，走 **解析 → 保存**，控制台 **无 CORS 错误**，且 Neon 中能 `SELECT` 到新行。

---

## 与本地 `.env` 的关系

本机根目录 **`.env`** 仅供 **`vercel dev`** 或本地运行 API 使用。  
**Vercel 线上**必须在控制台 **单独配置** 同名变量；**不会**自动读取你电脑上的 `.env`。

---

## 相关文件

- [`.env.example`](../.env.example) — 变量名模板  
- [`lib/api-http.js`](../lib/api-http.js) — CORS 与 Bearer 门禁  
- [`docs/环境变量与密钥.md`](./环境变量与密钥.md) — 安全原则
