# Medusa 自托管部署架构与实施手册

> 本文是本项目的**实施基线与操作清单**。已确定项、建议项和需要用户提供/确认的事项分开标注，避免把设计当成已经部署完成。文档最后核对日期：2026-10-12。Medusa 和生态依赖持续更新；实际建项目时再次核验官方兼容说明，随后锁定版本，不追随自动升级。

## 0. 决策摘要

| 项目 | 当前决定 | 状态/约束 |
|---|---|---|
| 电商后端 | Medusa v2 | 版本在脚手架时选定并锁入 lockfile |
| 顾客店面 | Next.js 官方 Storefront | 与 Medusa 后端独立构建、独立发布；通过 Store API 连接 |
| 管理后台 | Medusa Admin | 随 Medusa 后端提供，不能将 Admin 密钥放进店面 |
| 首期运行环境 | 自管 VPS + Docker Compose | 单机是单点故障，必须配置异机备份并演练恢复 |
| 公网入口与域名 | Nginx Compose 容器 + Cloudflare 代理 | 两个主机名分别路由 Storefront 和 Medusa；Nginx 独占公网 80/443 |
| 源站 TLS | Cloudflare Origin CA + Full (strict) | Edge 与源站证书分开；Origin CA 不能用于浏览器直连信任 |
| 数据库 | PostgreSQL，自托管在 VPS | 数据卷持久化；版本固定到明确 patch/digest，不用浮动 `latest` |
| 队列/缓存 | Redis，自托管在 VPS | 内部网络访问；内存/持久化/淘汰策略按 Medusa 实际使用方式验证 |
| 商品图片 | S3 兼容对象存储，偏向 Cloudflare R2 | 尚未创建或验证；数据库备份不包含对象文件本身 |
| 容器镜像 | 后端、店面分别构建，GHCR 私有包 | Actions 用 `GITHUB_TOKEN` 写入；VPS 单独使用只读凭据拉取 |
| 发布方式 | 首期 CI 构建、手动部署 | 暂不让 Actions 远程 SSH 自动改生产，减少初期故障面 |
| 测试环境 | Staging 与 Production 数据/密钥隔离 | 同 VPS 仅在资源足够且做好隔离时采用 |

## 1. Medusa 组件与请求/数据流

```text
顾客浏览器
  └─ HTTPS → Cloudflare Edge（公开证书）→ Nginx 容器（Origin CA 源站证书）
       ├─ shop.example.com → Next.js Storefront 容器
       └─ api.example.com  → Medusa Server 容器（Store API + Admin）
                                  ├─ PostgreSQL（商品、订单、顾客等业务数据）
                                  ├─ Redis（Medusa 队列、事件等运行能力）
                                  └─ S3 兼容存储（商品图，目标方向 R2）

Medusa Worker 容器（同一后端构建版本，不向顾客开放）
  ├─ PostgreSQL
  └─ Redis

GitHub 源码 → GitHub Actions → 私有 GHCR 镜像 → VPS 拉取并运行
```

Cloudflare 回源加密使用 Full (strict)；详细域名、TLS 与网络规则见[服务网络、域名与 Compose 约束](#4-服务网络域名与-compose-约束)。

- **Storefront**：顾客看到的网站；改外观/页面逻辑通常只需重新构建店面。
- **Medusa Server**：电商业务 API 和 Admin 所依赖的应用服务；商品数据通常通过 Admin 保存到 PostgreSQL，不必因每次商品录入重新部署。
- **Medusa Worker**：后台任务、事件订阅、定时任务等。生产拓扑计划与 Server 分开。Medusa 官方通用部署指南推荐生产使用 server/worker 模式；项目启动参数和 `workerMode` 必须按最终锁定版本核对。
- **PostgreSQL**：主要长期业务数据；必须备份并实测恢复。
- **Redis**：不是 PostgreSQL 的替代品。不可随意套用会丢弃队列任务的 eviction 策略，需针对 Medusa 当前队列行为选配置。
- **对象存储**：保存图片等文件；必须验证上传、读取、访问权限、URL/CDN 和环境隔离。

官方部署指南将 Medusa 应用的最低内存建议描述为至少 2GB RAM；这不是整台 VPS 的规格结论，VPS 还要运行 Storefront、Server、Worker、PostgreSQL、Redis 和操作系统，应通过 staging 压测与监控留出余量。参见[通用部署指南](https://docs.medusajs.com/learn/deployment/general)。

## 2. 版本与依赖锁定规则

### 2.1 原则：脚手架时核验，第一次构建后锁定

Medusa、Next.js、Node、数据库镜像和 GitHub Actions 的版本更新节奏不同。现在不把一组未经同一兼容矩阵验证的 patch 号假装成最终版本；但实施时必须形成精确版本清单，不能长期使用 `@latest`、`node:22`、`postgres:15`、`redis:7` 或可移动 `latest` 标签来决定生产实际版本。

Medusa 官方安装文档当前说明的 Node.js 基线为 **20.19.0+ 或 22.12.0+ 的 LTS**；Next.js Starter 还受当前 Next.js/React 要求约束。项目建议首选 Node 22 LTS，但脚手架日的官方兼容要求优先于此建议。检查：[Medusa 安装要求](https://docs.medusajs.com/learn/installation)、[Next.js 系统要求](https://nextjs.org/docs/app/getting-started/installation#system-requirements)、[Node.js 发布计划](https://nodejs.org/en/about/previous-releases)。

### 2.2 版本矩阵（实施时填写精确值并提交）

| 层 | 规划基线 | 精确版本如何确定/固定 | 不能做什么 |
|---|---|---|---|
| Medusa CLI / `@medusajs/*` | Medusa v2，同一兼容发行线 | 用脚手架创建后检查所有 `@medusajs/*` 包；避免混用不同版本线；保存 `package-lock.json`；CI 用 `npm ci` | 不让生产重新解析 `latest`；不单独升级一个核心包却不验证其余包 |
| Next.js Starter、Next.js、React | 采用与 Medusa Starter 配套版本 | 由所选官方 Starter 提供基线；核验 Medusa Starter 文档及 Next.js peer/runtime 要求；把 `package.json` 精确版本和 lockfile 提交 | 不把 Next.js/React 任意升级到未验证组合 |
| Node.js / npm | 优先 Node 22 LTS（以官方兼容范围为准） | ` .nvmrc` / `.node-version` 与 Docker 基础镜像统一；记录 Node 和 npm 精确版本；CI、开发、构建镜像一致 | 不让 Windows、WSL、CI、VPS 构建阶段使用不一致的 Node 主版本 |
| PostgreSQL | 主版本 15+ 的计划基线 | 选定具体受支持主版本及 patch；Compose 镜像 pin 到 patch，生产进一步锁 digest；升级按 PostgreSQL 升级路径操作 | 不用 `postgres:latest`；不认为跨主版本改 image tag 就完成数据库升级 |
| Redis | 主版本 7 的计划基线 | 固定具体 patch/digest；依据 Medusa 队列用途验证内存、持久化及淘汰策略 | 不在未验证时套用可能淘汰队列数据的配置 |
| Docker / Compose | Docker Engine + Compose plugin | 记录 VPS 与 CI 使用的受支持版本；升级前用 staging 验证 | 不依赖某台机器未记录的 Docker 行为 |
| 应用基础镜像 | Node 官方 LTS 镜像，分别供 backend/storefront | 固定 Node patch 标签并优先 pin digest；定期安全更新，重建并测试 | 不用不受控浮动标签；不在 ARM VPS 上假定构建镜像架构会自动匹配 |
| Nginx | 官方 Nginx 镜像，作为 Compose 唯一公网入口 | 固定明确版本/digest；配置放 Git，证书私钥不入 Git | 不同时再配置主机 Nginx，避免双重代理/端口冲突 |
| Cloudflare Origin CA | Cloudflare 为源站签发的证书 | 证书与私钥安全存放 VPS，通过只读挂载交给 Nginx；记录到期日并提前轮换 | 不是浏览器直接信任的公开证书；不能关闭 Cloudflare 代理后假定源站证书仍被浏览器信任 |
| GitHub Actions | 官方 action，版本与供应链审核策略一致 | workflow 用完整 commit SHA pin action；更新时由 Dependabot/人工核验 release 和 SHA | 不只写 `@main` 或不受控分支 |
| Medusa providers/plugins | 与 Medusa 主版本兼容 | 按官方 provider 文档安装，精确锁版本；CI 构建和 Staging 集成测试 | 不凭 npm 包名推断配置参数或兼容性 |

**版本冻结记录应写入仓库**，例如 `docs/dependency-matrix.md` 或本表填充后的表格，至少包含：组件、精确版本、官方来源/发布日期、锁定文件或镜像 digest、验证日期、升级负责人/步骤。每次版本升级要有单独 PR，先 CI 再 Staging。

> 文档撰写日不在线验证具体 patch 组合；因此这里明确提供支持范围和固定方法，而非编造一组“最新且已验证”的数字。开始 scaffold 前应重新打开官方文档，选出精确版本后再开始安装。官方链接见本文末尾。

## 3. GitHub Actions、GHCR 与你需要提供的权限

### 3.1 建议的最小权限方案

**构建并发布私有镜像：**同一仓库的 Actions workflow 使用 GitHub 自动提供的 `GITHUB_TOKEN`，workflow 明确声明最小权限：

```yaml
permissions:
  contents: read
  packages: write
```

配合官方 `docker/login-action` 登录 `ghcr.io`（用户名使用 `${{ github.actor }}`，密码使用 `${{ secrets.GITHUB_TOKEN }}`），再由 `docker/build-push-action` 构建并推送。将 image 名称设置为 `ghcr.io/<owner>/<package>`，并为后端和店面分别标记 commit SHA/Release 版本。无需为了**同仓库 Actions 构建并发布镜像**另行创建 GitHub API key 或 PAT；前提是 Actions 被允许运行、token 有 `packages: write`，且 GHCR 包权限允许该仓库写入。实际首次推送后检查 package 与仓库的关联/访问设置。

**VPS 拉取私有镜像：**这是另一个身份。VPS 不会自动继承 Actions 的 `GITHUB_TOKEN`，需配置一个独立的只读 GHCR 凭据（GitHub classic PAT，最小 `read:packages` scope，且账号有该 package 的读取权）。将其安全地用于 VPS 的 `docker login ghcr.io`，不要写进 Compose 文件、仓库、镜像或终端历史；可使用 Docker credential store。该 token 可设到期日并安排轮换。若账户/组织启用 SSO，还要授权 token。GitHub 对 GHCR 外部 CLI 拉取私有包的认证说明见[Container registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token)。

### 3.2 用户需要做什么

| 时间 | 你需要操作/提供 | 是否需要把密钥告诉 Claude/写入 Git |
|---|---|---|
| 开始项目时 | 确认 GitHub 仓库 owner/name、是否允许 GitHub Actions、Actions workflow 权限，以及目标默认分支 | 否；仓库名不是密钥 |
| 首次 CI 发布时 | 如 Actions 默认限制包写入，在仓库 Settings → Actions → General 中允许 workflow 访问包；确认 `GITHUB_TOKEN` 有 `packages: write` | 不需 PAT/API key；GitHub 自动签发 token |
| VPS 拉私有 GHCR 时 | 在 GitHub 创建仅 `read:packages` 的 classic PAT；在 VPS 登录 GHCR；验证 `docker pull` 成功 | 只在 VPS 安全录入，不发给 Claude、不提交、不贴日志 |
| 自动 SSH 部署（以后可选） | 创建受限 deploy 用户和专用 SSH key；把私钥存为 GitHub Actions secret，固定服务器 host key | 不在本聊天中提供私钥；首期建议不启用自动 SSH 部署 |
| 正式业务接入时 | 在各供应商后台创建 Staging/Test 与 Production 凭据；决定支付、邮件、对象存储配置 | 通过服务器安全环境配置/Secret Store 输入，不进 Git/镜像 |
| 服务器上线前 | 准备 VPS SSH 访问、操作系统、CPU 架构、磁盘、内存、备份存储及实际域名/服务地址 | 提供非敏感参数即可；密码仍自行安全录入 |

**GitHub Actions 要不要 API？**对于“构建并推 GHCR”，通常不需要你提供额外 GitHub API key：`GITHUB_TOKEN` 足够。Actions runner 本身使用 GitHub 平台 API 能力，但 token 由 GitHub 自动提供并限制权限。私有镜像的 VPS 拉取，以及未来的 SSH 部署，则是独立授权事项。

参考：[GitHub Actions 包权限](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)、[使用 GITHUB_TOKEN 发布包](https://docs.github.com/en/actions/publishing-packages/publishing-docker-images)、[GHCR Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

### 3.3 首期发布流水线边界

建议第一期 workflow 做：checkout → 配置 Node → `npm ci` → lint/typecheck/test → build → Docker buildx build → GHCR 登录 → push commit SHA 标签。先不让同一个 workflow 自动 SSH 到生产机；人工在 VPS 设置目标 tag、拉取、备份/迁移/更新并 smoke test。自动部署作为二期工作，在 Staging 和回滚验证通过后再决定。

- PR：只验证，不推送生产镜像、不接触生产 secrets。
- 默认分支合并：构建并发布不可变 commit-tagged 镜像；不自动更新生产。
- Release/人工批准：选择某个已验证 SHA 发布到 Staging/Production。
- GHCR 包设为 Private；核对包访问策略，确保正确仓库 workflow 可写、VPS read-only 凭据可读。
- Node Docker 镜像和 buildx 平台必须匹配目标架构。若 VPS 为 ARM64，CI 发布至少要含 `linux/arm64`；若同时有本机开发 x86 构建，也可发布 multi-platform manifest。

## 4. 服务网络、域名与 Compose 约束

### 4.1 域名路由建议

使用两个 Cloudflare 代理的主机名；把 `example.com` 替换成实际域名。Cloudflare DNS 橙云代理开启后，访客连接 Cloudflare，由 Cloudflare 再安全回源到 VPS 上的 Nginx。

| 主机名（占位） | Cloudflare DNS | Nginx 路由到 | 用途 |
|---|---|---|---|
| `shop.example.com` | A → VPS IPv4；仅在 VPS IPv6 已配置并验证可达时再添加 AAAA，Proxied | `storefront` Compose 服务 | 顾客 Next.js 店面 |
| `api.example.com` | A → VPS IPv4；仅在 VPS IPv6 已配置并验证可达时再添加 AAAA，Proxied | `medusa-server` Compose 服务 | Medusa Store API、Admin API 和 Admin UI（路径按实际版本确认） |

建议第一版不单独拆 `admin.example.com`：Medusa Admin 初始使用实际版本默认路径（常见为 `/app`），与 API 共用 Medusa Server。管理入口要保护，但不能用一个覆盖整个 `api.example.com` 的 Basic Auth 挡住 Store API、登录、支付 webhook 或 Admin 自身的认证请求。保护策略应按真实路由和认证流程验证。

### 4.2 Cloudflare TLS 与源站证书

```text
浏览器 ── HTTPS（Cloudflare Edge 证书）──> Cloudflare Proxy
       ── HTTPS（Origin CA 证书，Full (strict) 验证）──> Nginx 容器
       ── 私有 Compose 网络 ──> Storefront / Medusa Server
```

本方案选择 **Cloudflare Proxy + Cloudflare Origin CA + Full (strict)**：

1. Cloudflare 管理浏览器到 Cloudflare Edge 的公开证书。
2. 在 Cloudflare 控制台为源站创建覆盖实际 `shop`、`api` 主机名的 Origin CA 证书和私钥，将证书安装到 VPS 的受保护目录，并以只读方式挂载给 Nginx。
3. Cloudflare SSL/TLS encryption mode 设为 **Full (strict)**。不要使用 Flexible；strict 模式会验证 Cloudflare 回源时看到的源站证书。
4. Origin CA 证书不是浏览器普遍信任的公网站点证书。若访客绕过 Cloudflare 直接访问 VPS IP/源站，浏览器可能报证书不受信任；只有 Cloudflare 代理回源时才按此方案工作。
5. 若决定只允许 Cloudflare 回源，VPS 云防火墙/主机防火墙的 80/443 入站应限制为 Cloudflare 官方公布的 IP ranges，并在其变更时更新规则。SSH 单独保留且限制来源；添加规则前确认控制台/救援访问可用，避免误锁 VPS。若需要直接源站访问或 Cloudflare 故障时绕行，应改用浏览器信任的源站证书方案（如 Let's Encrypt），而不是期待 Origin CA 被浏览器信任。
6. Origin CA 没有本方案中的 Certbot ACME 自动续期流程。记录证书到期日、提前重新签发/轮换；更新证书后检查 Nginx 配置并 reload。Edge 证书与 Origin CA 是两张不同证书，分别检查状态。

**密钥约束：**Origin 私钥不提交 Git、不放进镜像、不贴到聊天或日志。限制 VPS 文件权限；Compose 只读挂载证书路径。证书续期/轮换后执行 Nginx 配置检查和 reload，并通过 Cloudflare 访问进行验证。

### 4.3 Compose 网络、端口和配置

```text
公网 80/443
    │
    ▼
nginx（唯一 ports 发布者；web 网络）
    ├── storefront（web 网络）
    └── medusa-server（web + data 网络）
                                ├── postgres（data 网络）
                                └── redis（data 网络）
medusa-worker（data 网络） ────┘
```

| 服务 | 公网端口 | Compose 网络 | 说明 |
|---|---:|---|---|
| `nginx` | `80:80`, `443:443` | `web` | 唯一映射到 VPS 公网的应用服务；Nginx 镜像版本固定 |
| `storefront` | 无 | `web` | Nginx 通过 Compose 服务名访问；内部监听端口以构建后配置核实 |
| `medusa-server` | 无 | `web` + `data` | 接受来自 Nginx 的请求并访问 DB/Redis；实际端口/健康路由核实 |
| `medusa-worker` | 无 | `data` | 无需公网入口，连接 Redis/PostgreSQL |
| `postgres` | 无 | `data` | 不发布 `5432` 到主机 |
| `redis` | 无 | `data` | 不发布 `6379` 到主机 |

Cloudflare 代理 → Nginx → Compose 服务时，Nginx 上游使用 Compose DNS 服务名（例如 `storefront:<实际容器端口>` 和 `medusa-server:<实际容器端口>`），不能把 `localhost` 当成另一个容器。将 Medusa Storefront 后端 URL 配为 `https://api.example.com`，但准确的环境变量名必须以生成的 Storefront `.env.template`/代码为准。为 `STORE_CORS`、`ADMIN_CORS`、`AUTH_CORS` 填入真实允许来源；Store API 的 publishable key 可出现在浏览器，Admin/JWT/数据库/支付/对象存储 secret 只能在后端安全环境中。

Nginx 需将原始 Host、客户端 IP 链、HTTPS/转发协议等必要头传给上游；Medusa/Next 是否信任代理头、cookie secure 行为和重定向 URL 要按实际版本配置与测试。不要直接照抄未经验证的示例配置。Compose 的 `depends_on` 启动顺序不能代替应用重试和健康检查。

### 4.4 首次配置与切流顺序

1. 创建 Cloudflare proxied DNS 记录，并确认域名解析到预期 zone/代理状态。
2. 生成 Origin CA 证书，安全放入 VPS 路径；配置 Nginx 只读挂载证书/私钥。此处不将证书内容存入仓库。
3. 设置 Cloudflare SSL/TLS 为 Full (strict)，确认 Edge 证书有效、Origin 证书覆盖主机名且有效期足够。
4. 构建并启动 Nginx、Medusa Server、Storefront；用 Compose 内部网络确认服务名和端口可达。
5. 使用 Nginx 配置测试命令（如 `nginx -t`，按镜像实际入口执行），确认通过后 reload；检查容器日志和访问/错误日志。
6. 从外部通过 Cloudflare 测试 HTTPS 店面、API 健康路由、Store API（带 publishable key）、Admin 实际路径/登录、支付 webhook 路由；检查浏览器 CORS/Network。
7. 通过 Cloudflare 访问确认源站严格 TLS 正常；确认公网不能直连 PostgreSQL/Redis/应用端口。若已启用 Cloudflare-only 防火墙，再检查仅 Cloudflare 回源能通过，且 SSH/控制台救援可用。
8. 制定 Origin CA 证书到期提醒与轮换演练：更新挂载文件、Nginx 配置测试/reload、Cloudflare smoke test。

**实施前必须回填并验证：**实际域名、VPS IPv4/IPv6、Medusa/Next 容器端口、Admin path、health path、Storefront 后端 env 名、Medusa CORS 三项、Nginx forwarded headers、Cloudflare zone/proxy、Origin 证书路径及续期提醒责任人。

### 4.5 Nginx/Cloudflare 故障排查

| 现象 | 优先检查 | 常见原因 |
|---|---|---|
| Cloudflare 521/522 | VPS 是否在线、防火墙是否允许 Cloudflare IP、Nginx 容器是否监听 80/443 | 源站拒绝连接/超时、端口映射错误、Cloudflare IP 未加入 allowlist |
| Cloudflare 525/526 | Full (strict)、Origin CA 链/有效期/主机名覆盖、Nginx 证书路径和日志 | TLS 握手失败、证书过期或不覆盖回源 host、私钥/证书不匹配 |
| Nginx 502/504 | `docker compose ps/logs`、Nginx 上游服务名与端口、Compose network | upstream 名错、服务未就绪、服务在不同网络、误用 localhost |
| 店面调用 API 被 CORS 拒绝 | 浏览器 Network 的 Origin、Medusa CORS env、容器实际 env | `STORE_CORS` 不含店面 origin、改了 env 未重启正确服务 |
| HTTPS 循环/生成 http 链接 | Nginx forwarded proto/host、Cloudflare TLS mode、应用 trusted proxy | 转发协议不一致，Flexible 模式，应用不信任代理头 |
| 主机名到错服务 | DNS proxied record、Nginx `server_name`、默认 server 配置 | Host 匹配缺失/冲突、DNS 指向旧 IP、误将 API 路由到店面 |
| 直连 VPS 显示证书不受信任 | 确认请求是否绕过 Cloudflare | Origin CA 只被 Cloudflare 用于源站验证；直连需公开信任证书 |
| DB/Redis 从外网可连 | Compose `ports`、云防火墙和 `ss -lntp` | 错误发布 5432/6379 或绑定 `0.0.0.0`；移除端口映射并关闭防火墙入口 |

### 4.6 其他网络约束

- 生产 Compose 用 `image:` 和固定 image tag，不在 VPS 上 `build:`。
- 配置健康检查、restart policy 和日志轮转；`depends_on` 不能代替应用重试。
- PostgreSQL 卷升级前备份；绝不可用 `docker compose down -v` 清理生产环境。
- Redis 的 `maxmemory`、持久化与 `maxmemory-policy` 需在 Staging 进行队列任务测试后决定。
- VPS 防火墙仅开放必要入口：SSH（最好限制来源）与 80/443（按 Cloudflare-only 决策限制 Cloudflare IP）；DB、Redis、Storefront、Medusa upstream 不开放公网。

## 5. 配置与密钥清单

变量名会随 Medusa/Starter 版本和所选 provider 变化。以下是**配置类别**，脚手架完成后以生成的 `.env.template`、官方文档和代码核准准确名称。

| 放置位置 | 配置类别/示例 | 秘密？ | 说明 |
|---|---|---:|---|
| Medusa Server/Worker 运行环境 | `DATABASE_URL`、`REDIS_URL` | 是 | Server/Worker 使用相同环境目标，但仅授予必要访问 |
| Medusa Server/Worker 运行环境 | `JWT_SECRET`、`COOKIE_SECRET` 等认证密钥 | 是 | 生成强随机独立值；Staging/Production 不复用 |
| Medusa Server 运行环境 | `STORE_CORS`、`ADMIN_CORS`、`AUTH_CORS` | 否（但敏感配置） | 只允许需要的域名；不能生产通配符 |
| Medusa Server/Worker 运行环境 | Stripe/PayPal secret、Webhook secret、邮件 provider secret | 是 | 依所选集成确认；Webhook secrets 对应正确环境 |
| Medusa Server 运行环境 | S3/R2 endpoint、bucket、region、access key/secret | endpoint/bucket 通常否；key/secret 是 | 不把 bucket secret 放到前端 |
| Storefront 构建/运行环境 | Medusa backend URL、`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | URL/key 可公开 | publishable key 不是 Admin secret；Next 的 `NEXT_PUBLIC_*` 会暴露给浏览器 |
| Storefront 构建/运行环境 | Stripe publishable key（如采用） | 可公开 | 不能放 Stripe secret key |
| GitHub Actions Secrets/Variables | 非敏感镜像名、必要的 deploy SSH private key（仅自动部署时） | 按字段 | 构建推 GHCR 不需自建 GHCR PAT；`GITHUB_TOKEN` 自动提供 |
| VPS 安全配置 | GHCR pull token、生产 env 文件/secret store | 是 | 权限最小、文件权限受限、轮换；不要复制进仓库目录后意外提交 |

`.env.example` / `.env.template` 只能含变量名和示例占位符，不得有可用凭据。检查 `.gitignore` 覆盖 `.env*`，但提交模板文件例外。

## 6. 数据迁移、备份与回滚

### 发布前迁移

Medusa 通用部署指南要求生产发布前处理应用数据库迁移和 link 同步。实际命令与执行位置应查看锁定版本的官方部署指南；旧文档中的 `medusa db:migrate` 不能脱离版本/构建目录直接照搬。迁移作为独立、可审计的一次性 release job 执行，不能让 server 和 worker 两个副本同时抢跑迁移。

### PostgreSQL 与媒体备份

- 备份 PostgreSQL 到 VPS 之外（加密、限制访问、设置保留期）；定义可接受的数据丢失窗口和恢复时间。
- 定期在隔离环境实际恢复并检查商品、订单、用户、关联关系；记录恢复用时和步骤。
- 对 R2/S3 对象文件单独定义版本控制/复制/恢复策略；数据库 dump 通常只存 metadata/URL，不含图片 bytes。
- Redis 是否备份取决于队列状态语义；不要将缓存恢复策略与数据库恢复混为一谈。

### 回滚

- 保留上一版后端/店面镜像 digest 与 Compose 配置。
- 只改应用且数据库向后兼容时，可切回旧 image tag。
- 若迁移破坏兼容，应用回滚可能失败；必须按备份恢复计划操作，并评估恢复期间新增订单如何处理。
- Production 部署流程必须有操作人、时间点、迁移结果、验证结果和回滚决定记录。

## 7. 分阶段实施清单与验收

### Phase 0 — 前置决策（用户需要参与）

- [ ] 确认仓库 owner/name、默认分支，以及是否启用 GitHub Actions。
- [ ] 确认 GHCR 使用私有包；Actions 允许 `GITHUB_TOKEN` 发布 package。
- [ ] 准备 VPS：供应商、地区、CPU 架构（x86_64/ARM64）、RAM、磁盘、备份目的地、SSH 管理方式。
- [ ] 确认 Storefront/API/Admin 的主机名和路径策略（用户已熟悉域名/HTTPS，无需在此重复基础知识）。
- [ ] 如走本方案 Cloudflare 路线：建立 `shop` / `api` 的 Proxied DNS 记录；创建 Origin CA 证书并私密安装到 VPS；设置 Full (strict)；决定并安全应用仅允许 Cloudflare 回源的防火墙规则。
- [ ] 验证 VPS 是否实际使用 IPv6 后才配置 AAAA；确认 Cloudflare IP allowlist 更新责任和 SSH/控制台救援入口。
- [ ] 决定图片存储服务与账号；正式支付/邮件服务可以先不配置，用测试模式验证。
- [ ] 所有私钥和真实 secrets 由用户亲自在 GitHub/VPS/provider 后台输入，不在对话中传递。

### Phase 1 — 本地 Medusa 能力验证

- [ ] 官方脚手架生成 monorepo，确认 backend、storefront 各自入口、Node 版本、包管理器、锁文件。
- [ ] 生成具体依赖版本清单；检查 `npm ls`/lockfile 中 Medusa 包版本一致。
- [ ] Admin 建立一个测试商品；Storefront 通过 Store API 展示；验证价格/区域/币种读取。
- [ ] 验收购物车和测试支付/模拟支付；不接受真实款项。
- [ ] 记录问题时附 Medusa 版本、Node/npm 版本、执行目录、命令、完整错误栈（先移除 secrets）。

### Phase 2 — 构建镜像与 Actions

- [ ] 后端和店面各自 Dockerfile 能从干净 checkout 构建。
- [ ] CI 使用锁文件安装依赖；Node 与本地基线一致；Actions 版本 pin 到 SHA。
- [ ] 首次发布确认 `GITHUB_TOKEN` package 权限与 GHCR 仓库/package 关联。
- [ ] 产物包含正确 VPS 平台；使用 commit SHA 标记；保存构建日志和镜像 digest。
- [ ] 确认私有 GHCR 包没有误设为 public；VPS 只读凭据成功 pull。
- [ ] 用 secret scanning 检查 Git diff、构建日志和镜像层，不得泄漏密钥。

### Phase 3 — VPS Staging

- [ ] Compose 网络、卷、healthcheck、restart policy 和日志轮转都已配置。
- [ ] DB/Redis 仅内部访问；Admin 受保护；CORS、publishable key正确。
- [ ] Server 与 Worker 分别启动并验证后台任务会被消费。
- [ ] 迁移只运行一次，迁移完成后服务健康。
- [ ] 图片上传/读取、Store API、购物车、测试支付、webhook 和邮件通过。
- [ ] 完成数据库异地备份恢复和应用镜像回滚演练。

### Phase 4 — Production readiness

- [ ] 支付 webhook 验签、重复事件幂等、重试/失败补偿、退款和订单状态一致性已测试。
- [ ] 备份恢复可用；监控、告警、磁盘余量、Redis/Worker backlog 有负责人。
- [ ] 生产 secrets 与测试 secrets 完全分开；镜像 digest 和迁移版本记录完备。
- [ ] 先做人工批准的 release；通过多次稳定发布后再评估自动部署。
- [ ] 税务、配送、隐私和支付 provider 使用资格已由相应专业/供应商渠道确认。

## 8. 故障定位速查

| 现象 | 首先检查 | 常见原因/修复方向 |
|---|---|---|
| `npm ci` 或 Medusa build 失败 | Node/npm 版本、工作目录、lockfile、完整首个错误 | Node 不在支持范围；lockfile 与 package 不匹配；Medusa 核心包版本线混用；内存不足 |
| Docker build 成功但 VPS `exec format error` | `docker image inspect` 的架构、buildx platforms、VPS `uname -m` | CI 只构建了 amd64，而 VPS 是 ARM64（或相反） |
| GHCR push 401/403 | workflow `permissions`、Actions 设置、package access、image 名称/owner | 缺 `packages: write`；包未授权当前仓库；namespace 大小写/路径错误 |
| VPS pull 私有镜像 401/denied | `docker login ghcr.io` 的账号、PAT scope、package read access、token 是否过期 | 缺 `read:packages`；package 无该用户权限；token 过期/未授权组织 SSO |
| Cloudflare 521/522 | Nginx 容器、VPS firewall/云防火墙、Cloudflare IP 范围、端口映射 | 源站拒绝/超时；Cloudflare IP allowlist 过时；Nginx 未监听 |
| Cloudflare 525/526 | Cloudflare TLS mode、Origin CA 主机名/到期日、Nginx 证书挂载/日志 | 源站 TLS 握手失败、证书过期/主机名不匹配；错误使用 Flexible |
| Nginx 502/504 | Nginx upstream、Compose DNS/网络、后端容器日志 | 服务名/端口错误、容器不在共享网络、应用未启动 |
| Nginx/Cloudflare HTTPS 循环或 CORS 错误 | forwarded proto/host、Cloudflare mode、Medusa CORS 与店面实际 Origin | 代理头/模式不匹配；CORS 缺少正确来源；Origin CA 证书访问绕过 Cloudflare |
| Medusa 启动连不上 DB/Redis | Compose DNS 名、容器网络、连接串、服务健康和日志 | 容器里误用 `localhost`；密码/url 编码错误；服务未 ready；环境变量未注入 |
| Medusa API 401/商品列表空 | publishable key、发布状态、region/货币配置、请求 URL/headers | key 缺失/错误；商品 draft；Store API 要求字段/区域不匹配 |
| CORS 或浏览器请求失败 | 浏览器 Network/Console、Medusa CORS env、Origin | Storefront 域名未列入 `STORE_CORS`；改了 env 却没重启/重建正确服务 |
| Checkout/Payment provider 报错 | provider 配置、区域关联、test/live key、webhook endpoint/secret | 后端模块未注册；provider 未给 region 启用；测试与生产凭据混用 |
| 商品图片上传成功但访问 403/404 | S3 endpoint/region/bucket、key权限、公开 URL/CDN配置 | endpoint 区域错误、读权限/URL设置错误、后台/店面访问路径不一致 |
| 部署后启动报 migration/schema 错 | 发布日志、当前 image digest、迁移执行记录、数据库备份 | 漏跑迁移/link sync；迁移跑错版本/目录；Server/Worker 同时执行迁移 |
| Worker 没有处理任务 | Worker mode、Redis URL、同版本镜像、worker日志/队列 | Worker 实际以 server mode 启动；Redis不通；订阅代码未加载 |

排错时一次只改变一个变量，记录“现象 → 日志 → 假设 → 修改 → 验证”；不要为了试错直接清空生产数据库或删除 Docker volumes。

## 9. 变更发布规则

| 变更 | 需要的操作 |
|---|---|
| Admin 上传/修改商品 | 更新业务数据；通常不构建/部署应用 |
| Next.js 页面/样式 | 构建并更新 Storefront image |
| Medusa 后端代码或 provider 配置 | 构建并更新 backend image；按变更检查迁移 |
| Node/Medusa/Next 依赖升级 | 变更精确版本和 lockfile；CI、Staging 全测；新镜像；必要迁移 |
| PostgreSQL 主版本升级 | 单独数据库升级计划、备份恢复演练；不可仅改 Compose tag |
| Actions workflow/action SHA 更新 | 检查权限最小化、release notes、CI 测试；不自动触碰生产数据 |

## 10. 官方文档与实施前再核验

- [Medusa 安装与运行要求](https://docs.medusajs.com/learn/installation)
- [Medusa Docker 安装指南](https://docs.medusajs.com/learn/installation/docker)
- [Medusa 生产构建](https://docs.medusajs.com/learn/build)
- [Medusa 通用部署指南（含 server/worker、环境变量、迁移和健康检查）](https://docs.medusajs.com/learn/deployment/general)
- [Medusa 部署概览](https://docs.medusajs.com/learn/deployment)
- [Medusa 配置](https://docs.medusajs.com/learn/configurations/medusa-config)
- [GitHub Actions 自动 token 身份认证](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [GitHub 官方 Docker 镜像发布示例](https://docs.github.com/en/actions/publishing-packages/publishing-docker-images)
- [GHCR Container registry 认证与权限](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Buildx setup action](https://github.com/docker/setup-buildx-action)
- [Docker Build Push action](https://github.com/docker/build-push-action)
- [Node.js LTS 发布计划](https://nodejs.org/en/about/previous-releases)
- [Next.js 系统要求](https://nextjs.org/docs/app/getting-started/installation#system-requirements)
- [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Cloudflare Full (strict) 模式](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [Cloudflare IP 地址范围](https://www.cloudflare.com/ips/)
- [Nginx Docker Official Image](https://hub.docker.com/_/nginx)

---

本文不代替支付、税务、法律或供应商资格意见；图中架构是设计，未表示服务已经部署。执行真实构建前，先填全第 2 节的精确版本矩阵、第 7.1 节的用户输入项，并在 staging 通过所有验收门槛。
