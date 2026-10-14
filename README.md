# B2Csite 使用说明

本项目是 Medusa v2 电商后端 + Next.js 顾客店面的 monorepo。本文说明日常开发、发布和 VPS 更新流程；它不表示 Vercel、VPS、域名或支付服务已经配置完成。

## 一、部署分工

| 部分 | 放在哪里 | 更新方式 |
|---|---|---|
| Storefront（顾客店面） | Vercel | Vercel 连接 GitHub 后构建 Next.js 并部署；不发布 Storefront Docker 镜像 |
| Medusa Backend/Admin | 云 VPS | GitHub Actions 构建 Backend 镜像并发布 GHCR；你在 VPS 手动拉取和更新 |
| PostgreSQL / Redis | VPS 私有网络 | Compose 管理；新环境从空数据开始，和本机数据隔离 |

```text
改 Storefront → 推送 GitHub → Vercel 构建并部署
改 Backend    → 推送 GitHub → Actions 检查/构建 Backend 镜像 → GHCR
                                                            ↓
                                      你在 VPS 选择镜像并手动 Docker 更新
```

Actions **不会 SSH 登录或自动改动 VPS**。Vercel 和 VPS 之间通过公开 HTTPS Medusa API 通信。

## 二、运行环境和安装

仓库固定使用 Node.js `24.21.0` 与 npm `11.19.0`。在仓库根目录检查版本并安装依赖：

```sh
node --version
npm --version
npm ci
```

本地运行应用前需要可用的 PostgreSQL 和 Redis。可用本机已安装的服务，也可以用 local Compose。

### 用 Docker Compose 启动本地全栈

1. 复制 `infra/local/.env.example` 为 `infra/local/.env.local`。
2. 在该文件中配置仅供本地使用的随机 PostgreSQL、JWT、Cookie、MFA 密钥，以及 Medusa Admin 创建的本地 Publishable API Key。
3. 从仓库根目录启动：

   ```sh
   docker compose --env-file infra/local/.env.local -f infra/local/compose.yaml up --build
   ```

   本地地址：Storefront `http://localhost:18000`；Medusa Admin/API `http://localhost:19000`。PostgreSQL 和 Redis 端口只绑定本机回环地址。

4. 停止服务时不要加 `-v`：

   ```sh
   docker compose --env-file infra/local/.env.local -f infra/local/compose.yaml down
   ```

   PostgreSQL 使用持久化 named volume。不要因重建应用或清理缓存删除数据库 volume。

### 直接运行开发服务器

先确保 PostgreSQL、Redis 和环境变量已经可用。Backend 可根据 `apps/backend/.env.template` 配置本地环境；Storefront 根据 `apps/storefront/.env.example` 设置公开变量。分别在仓库根目录运行：

```sh
npm run backend:dev
npm run storefront:dev
```

常见检查命令：

```sh
npm run lint --workspace=@dtc/backend
npm run lint --workspace=@dtc/storefront
npm run typecheck --workspace=@dtc/storefront
npm run test:unit --workspace=@dtc/backend
npm run build
```

运行单个 Backend 单元测试：

```sh
npm run test:unit --workspace=@dtc/backend -- --runTestsByPath src/search/helpers/__tests__/resolve-product-ids.unit.spec.ts
```

目前 Backend HTTP/module integration test 命令已配置，但没有匹配的集成测试；见 [`TODOS.md`](TODOS.md)。Storefront 暂无独立测试套件。不要把“命令成功但 0 tests matched”当成集成测试覆盖。

## 三、改 Storefront 后怎么更新

Storefront 源码在 `apps/storefront`。调整页面、组件、样式或交互后：

1. 本地运行 Storefront lint、typecheck 和全仓 build。
2. 提交并推送分支/PR。
3. Vercel 项目已连接 GitHub 时，会按项目分支设置创建 Preview；合并到 Vercel 配置的生产分支后，会自动构建并部署 Production。
4. 在 Preview 检查前端页面以及它与 Medusa API 的交互；确认后再合并/发布到生产分支。

Vercel 需要为 Preview 与 Production 分别设置：

- `NEXT_PUBLIC_MEDUSA_BACKEND_URL`：对应环境可公网访问的 Medusa HTTPS API 地址。
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`：在对应 Medusa Admin 创建并关联到 Storefront Sales Channel 的 Publishable API Key。
- `NEXT_PUBLIC_DEFAULT_REGION`：默认区域国家代码。
- `NEXT_PUBLIC_BASE_URL`：当前环境的公开店面 URL。

这些 `NEXT_PUBLIC_*` 值会出现在浏览器中，只能放公开配置。**Admin key、数据库/JWT/Cookie/支付/对象存储 secret 绝不能放进去。**Preview 应使用独立的 staging API 和 key，不要让不受信任的预览站点连接正式环境。

单纯调整 UI 通常不需要重新部署 Medusa；但若前端改了 Store API 路径、请求字段、结账或认证流程，就可能与当前 Backend 行为不兼容。用 Preview 对 staging 验证区域、商品、图片、购物车、账户和结账流程，再发布正式站点。Medusa 的 CORS 也必须允许对应的 Vercel origin。

## 四、改 Backend 后如何发布

Backend 源码在 `apps/backend`。更新路由、搜索、workflow、module、provider 或 Medusa 配置后：

1. 本地运行 Backend lint/unit tests 和 `npm run build`。
2. 推送 PR。GitHub Actions 会用 Node/npm 24/11 执行安装、lint、Storefront typecheck、Backend 单测和两个 workspace build。
3. PR 合并到 `main` 后，质量检查通过才会触发 Backend Docker 镜像发布。
4. 镜像名为 `ghcr.io/<owner>/<repository>-backend:<commit-sha>`；按 workflow 输出记录镜像 digest。当前构建目标是 `linux/amd64` 和 `linux/arm64`。
5. 在 GitHub Actions run 确认 `Quality checks and build` 与 `Publish Medusa backend image` 都成功后，再由你手动在 VPS 更新镜像。

CI 使用假的 Publishable API Key 和 localhost 值只验证构建；它们不会连接真实 Medusa，也不是 Vercel 的生产配置。

### 数据库 migration 不是普通镜像更新

只改后端逻辑且 schema 不变时，通常更新 Backend 镜像即可。如果 Medusa/模块版本或数据模型改变，需要按对应镜像版本单独核验并运行 migration：

- 先确认连接的是 staging/production 的正确数据库并完成备份。
- PostgreSQL/Redis 先健康，再由一个受控的一次性 migration 步骤运行 `medusa db:migrate`（具体行为以要发布镜像内的 CLI 为准）。
- migration 完成后再启动/更新 Server 和 Worker，避免多个服务同时迁移。
- migration 不会自动创建 Store、Region、Sales Channel、Publishable API Key 或 Admin 用户；这些是另行初始化的业务基础数据。
- 应用镜像回退不保证能撤销数据库 schema migration。

初始数据 seed 有非幂等风险：不要将它挂到每次容器启动或每次发布中，也不要在有数据的库上盲目重跑。新 VPS 应用全新空数据库，不导入本地测试数据；本机已有 volume 保留。

## 五、在 VPS 上更新 Docker 镜像

首次搭建和配置说明在 [`docs/deployment.md`](docs/deployment.md)，Compose/Caddy 模板在 `infra/vps/`。示例域名与 secrets 都是占位内容，必须先在服务器填写真实值；模板目前未在实际 VPS 上启动验证。

日常 Backend 更新大致如下：

1. 在 GitHub Actions 选择成功的 `main` 发布 run，记下 Backend 镜像 commit SHA 和 digest。
2. 在 VPS 使用**只读** GHCR 凭据登录（不要在聊天或仓库中存放 token）：

   ```sh
   docker login ghcr.io
   ```

3. 在 VPS 的私有 Compose `.env` 中，把 `BACKEND_IMAGE` 更新到选定 SHA，例如：

   ```dotenv
   BACKEND_IMAGE=ghcr.io/<owner>/<repository>-backend:<commit-sha>
   ```

4. 在 Compose 目录拉取并更新服务：

   ```sh
   docker compose --env-file .env -f compose.yaml pull medusa-server medusa-worker
   docker compose --env-file .env -f compose.yaml up -d postgres redis medusa-server medusa-worker caddy
   docker compose --env-file .env -f compose.yaml ps
   ```

5. 检查 Medusa `/health`、Admin 登录、Store API、Worker 日志和 Vercel 店面请求。保留上个镜像 tag/digest 作为应用回滚选择。

不要用 `docker compose down -v`、删除 named volume 或重建数据库作为常规更新/回滚操作。PostgreSQL 备份需存放在 VPS 之外，并定期测试恢复；对象存储中的图片文件要另外备份。

## 六、当前尚未完成的线上事项

- Vercel 项目、域名、Preview/Production 环境变量需要在 Vercel 控制台配置并实测。
- VPS/DNS/TLS、GHCR pull 凭据、真实 server `.env`、空库 migration/bootstrap、数据库备份恢复及 Admin/API 连通性需要在 staging 真实验证。
- 支付尚未通过 provider、webhook 验签、幂等/重试、失败/退款流程测试前，不启用 live payment。
- 当前依赖审计仍有未解决项，尤其 Medusa 2.21.2 传递依赖链。不要运行 `npm audit fix --force` 降级 Medusa；部署指南记录当前已核验的审计状态。

未通过 staging、备份恢复和发布回滚验证前，不要把环境标记为 production-ready。
