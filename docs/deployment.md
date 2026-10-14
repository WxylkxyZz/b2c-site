# 部署与运维指南：Vercel Storefront + VPS Medusa

> 本文描述目标部署流程，不表示 Vercel、VPS、GHCR、域名、备份或支付已经配置或验证。命令和镜像需在真实 staging 主机核验后才能用于 production。

## 架构与发布边界

```text
Git repository
  ├─ Vercel Git integration：构建并部署 Next.js Storefront
  └─ GitHub Actions：质量检查 → 构建 Medusa Backend Docker 镜像 → 推送 GHCR
                                                       │
                                                       └─ 用户在 VPS 手动选择镜像并部署

Vercel Storefront ── HTTPS / Store API Publishable Key ──> VPS Medusa Server
                                                               ├─ PostgreSQL（持久化、内网）
                                                               ├─ Redis（内网）
                                                               └─ Medusa Worker（内网，不公开）
```

Vercel 仍会运行 Next.js production build，产出 Vercel 部署产物；它不需要 Storefront Docker 镜像。GitHub Actions 只发布 Backend 镜像，不 SSH 到 VPS。VPS 更新由用户检查 SHA/digest 后通过 Docker Compose 手动执行。

## Node/npm 和本地检查

项目基线为 Node.js `24.21.0`、npm `11.19.0`。从仓库根目录执行：

```sh
node --version
npm --version
npm ci
npm run lint --workspace=@dtc/backend
npm run lint --workspace=@dtc/storefront
npm run typecheck --workspace=@dtc/storefront
npm run test:unit --workspace=@dtc/backend
npm run build
```

CI 使用仅用于编译的非生产 Storefront 值；占位 key 不会连接 Medusa，也不能用于真实流量。

## Vercel Storefront

1. 将 Git 仓库导入 Vercel。仓库使用 npm workspaces，需从 monorepo 根目录安装依赖，并把 Vercel Root Directory / build target 配置到 `apps/storefront`。使用 Next.js framework preset 和正常的 `next build`。
2. 选择 Vercel 支持的 Node 24.x 运行时；仓库 `.nvmrc`、CI 和 Docker 使用精确的 `24.21.0`。
3. 在 Preview 与 Production 分别配置公开变量：
   - `NEXT_PUBLIC_MEDUSA_BACKEND_URL`：Medusa 可公网访问的 HTTPS API origin。
   - `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`：在对应 Medusa Admin 环境创建，并绑定店面使用的 Sales Channel。
   - `NEXT_PUBLIC_DEFAULT_REGION`：已配置的默认区域国家代码。
   - `NEXT_PUBLIC_BASE_URL`：该环境的 canonical Storefront URL。
4. `NEXT_PUBLIC_*` 会暴露到浏览器。不得放置 Admin 凭据、数据库密码、JWT/Cookie secret、支付 secret 或对象存储 secret。
5. Preview 使用隔离的 staging API/key；不要让不受信任的预览构建连接 production。Medusa CORS 只允许确切的店面来源。
6. 使用 Preview 验证区域重定向、regions/products API、图片、浏览器 CORS、购物车、账户及支持范围内的结账流程。真实支付需独立验证 webhook 验签、幂等、重试、失败与退款。

## VPS 服务模板

`infra/vps/compose.yaml`、`infra/vps/Caddyfile`、`infra/vps/.env.example` 用于**新建隔离环境**，不引用本地 Compose 数据卷。新 staging/production 数据库与 Redis 均为空，不从本地或旧环境导入数据；本地卷保持原样。

- Caddy 负责 API HTTPS 入口；`{$API_DOMAIN}` 是 Caddyfile 解析期环境变量替换语法。DNS 必须指向 VPS，入站 TCP 80/443 必须开放，证书自动签发方可成功。
- Compose 只发布 Caddy 的 80/443；PostgreSQL、Redis、Medusa 上游和 Worker 不发布公网端口。Worker 仅加入数据网，不由 Caddy 转发。
- Medusa 配置实际读取 `JWT_SECRET`、`COOKIE_SECRET`，不要误用 `AUTH_JWT_SECRET`/`AUTH_COOKIE_SECRET`。Backend 同时需要 `DATABASE_URL`、`REDIS_URL` 和准确的 CORS origin。
- PostgreSQL 密码进入 URL 格式的 `DATABASE_URL`；示例要求 URL-safe hex 值，例如 `openssl rand -hex 32`，避免 URI 特殊字符导致连接串解析错误。
- 所有真实密钥只放在 VPS 权限受限的 `.env` 或 secret manager，不入 Git、不放进镜像。用 `infra/vps/.env.example` 创建服务器私有配置，并分别管理 staging/production。
- `BACKEND_IMAGE` 必须指定 immutable commit SHA tag 或 digest。VPS CPU 架构需包含在 GHCR multi-arch manifest 中。
- 模板使用全新的命名卷。现有主机上运行前应检查 Compose project name 和 volume 实际解析结果；更新应用时不得执行 `docker compose down -v` 或删除数据卷。
- Admin 与 Store API 共用 API 域名。当前 Caddy 模板没有额外 Admin 身份/网络防护；确认 Admin 可访问策略。不要用覆盖整台 API host 的 Basic Auth 阻挡 Store API 或 webhooks。

## 首次空库部署与迁移

首次 staging/production 数据服务必须是新建、隔离的空数据库/Redis。不要将开发机数据库 dump 当作生产初始化模板，也不要重跑未核实的初始 seed：初始化脚本可能非幂等并产生重复 Store/Sales Channel/Key。

Medusa 当前 CLI 的 `db:migrate` 由锁定版本负责执行待处理模块迁移、link sync 及默认启用的 search/script migration 行为；使用前必须核对正在发布的镜像版本和 CLI help。由单次、受控 release 操作运行迁移，不能让 Server 与 Worker 并发迁移。迁移不等于初始化业务基础数据：Store、Region、Sales Channel、Publishable API Key 与 Admin 用户需使用该版本确认过的 CLI/Admin/workflow 步骤创建。

建议流程：

1. 准备 staging VPS、DNS、TLS、GHCR read-only 凭据和独立 secrets。
2. 先启动 PostgreSQL/Redis，等健康检查通过：

   ```sh
   docker compose --env-file .env -f compose.yaml up -d postgres redis
   ```

3. 对空数据库运行一次锁定镜像中的迁移/link sync：

   ```sh
   docker compose --env-file .env -f compose.yaml run --rm --no-deps medusa-server ./node_modules/.bin/medusa db:migrate
   ```

   `medusa db:migrate` 在当前安装的 Medusa CLI 2.21.2 中存在；每次 Medusa 升级仍须用实际 image 的 CLI help 和匹配的官方版本文档复核。此命令不得由 Server 与 Worker 并发执行。
4. 按受控步骤初始化 Medusa 基础数据及 Admin。迁移不创建 Store/Region/Sales Channel/Publishable API Key 或管理员用户；确认 bootstrap 可重复，或标明只执行一次。
5. 启动 server/worker/Caddy，验证 `/health`、Admin 登录、Store API、Vercel Preview CORS、worker 日志和媒体读写。
6. 配置异机 PostgreSQL 备份，并实际演练恢复；媒体对象存储另行备份。保留旧镜像和配置，确认数据库迁移兼容性后才回滚应用。
7. 完成 staging 测试后再建立新的 production 空数据环境。无需也不得因此删除本机数据卷。

## GitHub Actions 与 GHCR

`.github/workflows/ci.yml` 在 PR 和 main 执行锁定 Node/npm 安装、lint、Storefront typecheck、Backend unit tests 和 workspace builds。通过 main 检查后，另一个最小权限 job 发布 Backend 多架构镜像至 `ghcr.io/<owner>/<repo>-backend:<commit-sha>`，并打印 digest。Storefront 不发布 Docker 镜像；Actions 没有 VPS SSH key，也不远程部署。

GHCR package 若为 private，VPS 使用单独的、最小 `read:packages` 权限凭据。Actions 的 `GITHUB_TOKEN` 不能复用到 VPS。

## 人工更新 VPS

确认 GitHub Actions 发布成功、镜像 tag/digest 与架构正确，并按 release 方案完成必要 migration 后，在 VPS `.env` 设定新 `BACKEND_IMAGE`，从 VPS Compose 目录执行：

```sh
docker compose --env-file .env -f compose.yaml pull medusa-server medusa-worker
docker compose --env-file .env -f compose.yaml up -d postgres redis medusa-server medusa-worker caddy
docker compose --env-file .env -f compose.yaml ps
```

随后检查 Medusa health、Admin、Store API、Worker 日志和线上店面请求。保留上一个镜像供回退；绝不把删除 PostgreSQL/Redis volume 当作部署或回滚步骤。

## 当前验证状态

本机已验证 Node.js `24.21.0` / npm `11.19.0` 下工作区 build、Storefront lint/typecheck、Backend lint 和 9 个 Backend unit tests。三处 Storefront React Hooks dependency warning 已修复。本机依赖审计仍有 Medusa 2.21.2 传递依赖和 Tailwind/eslint 生态链漏洞；已将 Next.js 15 更新到 `15.5.27`、PostCSS 更新到 `8.5.30`、Jest 更新到 `30.5.2`。审计自动修复建议 Medusa `2.10.3`，这是从当前 `2.21.2` 降级，不能照做；registry 查询中 `2.21.2` 仍是最新 stable，`2.22` 只有 snapshot/preview，待正式兼容修复发行版后继续处理。Tailwind 4 与当前 Medusa UI preset 的 Tailwind 3 peer 范围冲突，需协调迁移后才能升级。在线 npm audit 操作受权限策略拦截；最后一次已获准审计结果为 115 项（84 moderate、31 high），不声称依赖漏洞已清零。当前执行权限也阻止 `npm ci` 清洁安装，故锁文件干净重装尚未验证。

GHCR 发布、Vercel 项目配置、VPS Docker 启动、TLS、空数据库 bootstrap、备份恢复和 production 购物流程均未在真实环境验证。
