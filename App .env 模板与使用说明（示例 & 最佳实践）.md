# ------------------------------------------------------------
# .env.example - 通用示例（提交到仓库，值为示例/占位符）
# 使用说明：复制为 .env 并填入真实值（不要将 .env 提交到版本控制）
# ------------------------------------------------------------

# 基本
NODE_ENV=development
PORT=4000
APP_NAME=MyApp

# 后端服务 / 数据库（两种写法示例）
DATABASE_URL=postgres://dbuser:dbpass@localhost:5432/mydb
# 或拆分字段（某些库/工具喜欢拆分）
DB_HOST=localhost
DB_PORT=5432
DB_USER=dbuser
DB_PASS=dbpass
DB_NAME=mydb

# 缓存/队列
REDIS_URL=redis://localhost:6379

# 验证/会话
JWT_SECRET=replace_with_a_strong_random_string
JWT_EXPIRES_IN=7d

# 第三方服务（示例占位）
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
SENDGRID_API_KEY=SG.xxxxx
SENTRY_DSN=https://example@sentry.io/12345

# OAuth
OAUTH_GOOGLE_CLIENT_ID=your-google-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret

# 前端相关（注意：前端暴露的变量不能放敏感信息）
FRONTEND_URL=http://localhost:3000
API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3000

# 日志/调试
LOG_LEVEL=info

# ------------------------------------------------------------
# .env.development - 开发专用（不要提交）
# ------------------------------------------------------------
# NODE_ENV=development
# PORT=4000
# ...（可覆盖 .env.example 的值）

# ------------------------------------------------------------
# .env.production - 生产示例（不要在仓库中放真实值）
# ------------------------------------------------------------
# NODE_ENV=production
# PORT=80
# DATABASE_URL=postgres://prod_user:prod_pass@prod-host:5432/prod_db
# JWT_SECRET=really_long_random_secret_in_production
# STRIPE_SECRET_KEY=sk_live_xxx
# SENTRY_DSN=https://prod@sentry.io/99999

# ------------------------------------------------------------
# Docker / docker-compose
# docker-compose.yml: 可以使用 env_file: - .env
# Dockerfile: 可用 ARG 在构建时注入（但 ARG 不安全，构建后会丢失）
# ------------------------------------------------------------
# 在 docker-compose.yml:
# services:
#   app:
#     env_file:
#       - .env

# ------------------------------------------------------------
# CI / 部署（不要在 CI 配置文件中明文写 secret）
# - GitHub Actions / GitLab CI / Travis 等应使用内置 secrets/variables
# - 在部署时由 CI 将 secret 注入环境或通过 provider 的秘钥管理器注入
# ------------------------------------------------------------

# ------------------------------------------------------------
# .gitignore 建议条目
# ------------------------------------------------------------
# .env
# .env.local
# .env.*.local
# .env.production
# .env.*.production

# ------------------------------------------------------------
# 使用示例：Node (Express / 任意后端)
# 1) 安装 dotenv: npm install dotenv
# 2) 在应用入口（最先）加载：
#
#    require('dotenv').config();
#
# 3) 访问变量：
#    const port = process.env.PORT || 3000;
#
# 建议使用 dotenv-safe 或 env schema 校验必需变量：
# npm install dotenv-safe
# ------------------------------------------------------------

# ------------------------------------------------------------
# 前端（注意安全边界）
# 1) create-react-app：变量必须以 REACT_APP_ 开头，例如：
#    REACT_APP_API_URL=https://api.example.com
#    在代码中使用：process.env.REACT_APP_API_URL
# 2) Next.js：暴露给浏览器的变量需以 NEXT_PUBLIC_ 开头；其他变量只在服务器端可用。
# 3) 不要把任何密钥或敏感 token 放到会被打包到浏览器的变量中（例如 JWT secret、Stripe secret 等）
# ------------------------------------------------------------

# ------------------------------------------------------------
# React Native
# - 推荐使用 react-native-config 或在原生层（Android/iOS）注入环境变量
# - 同样不要把敏感信息直接放到客户端可读的文件中
# ------------------------------------------------------------

# ------------------------------------------------------------
# Android / iOS 原生
# - Android: gradle.properties 或在 CI/CD 中注入构建变体（注意保密）
# - iOS: 在 Xcode 的 Build Settings / xcconfig 或使用 Secret 管理工具
# ------------------------------------------------------------

# ------------------------------------------------------------
# 安全与运维建议（摘要）
# 1) 永远不要将 .env/secret 文件提交到公有仓库；使用 .gitignore 忽略
# 2) 在生产环境使用托管的 secrets 管理器（AWS Secrets Manager、Parameter Store、GCP Secret Manager、Azure Key Vault、HashiCorp Vault）
# 3) CI/CD 使用仓库/项目级 secret 功能注入变量；不要在 CI 脚本里明文写
# 4) 定期轮换密钥并记录变更（audit logs）
# 5) 为敏感值配置最小权限（principle of least privilege）
# 6) 使用加密传输（TLS），不要在明文渠道传递 secret
# 7) 对必须存储加密的敏感数据使用 KMS（例如 AWS KMS）
# ------------------------------------------------------------

# ------------------------------------------------------------
# 进阶：在 Node 中按环境加载不同文件（示例）
# require('dotenv').config({ path: `.env.${process.env.NODE_ENV}` });
# ------------------------------------------------------------