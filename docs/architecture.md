# B2C 跨境 DTC 独立站 — 技术架构文档

| 项 | 值 |
|----|-----|
| 项目 | B2Csite — 跨境 DTC 独立电商站 |
| 文档版本 | v1.1（经 /plan-eng-review 审计修订） |
| 日期 | 2026-10-10 |
| 主体 | 美国公司（美区 Stripe） |
| 框架 | Medusa v2.21+（MIT，自托管） |
| 店面 | Next.js Starter（官方 App Router） |
| 收单 | Stripe（主）+ PayPal（次） |
| 结汇 | USD → WorldFirst/PingPong → CNY |
| 部署 | VPS 单机全栈 Docker Compose（Hetzner CAX21 美区） |

---

## 目录

1. [总体拓扑](#1-总体拓扑)
2. [技术栈](#2-技术栈)
3. [目录结构（monorepo）](#3-目录结构monorepo)
4. [部署架构](#4-部署架构)
5. [支付链路（三段式）](#5-支付链路三段式)
6. [税务合规](#6-税务合规)
7. [区域 / 货币 / 目录](#7-区域--货币--目录)
8. [安全](#8-安全)
9. [成本预估](#9-成本预估)
10. [落地步骤](#10-落地步骤)
11. [待确认 / 尽调备忘](#11-待确认--尽调备忘)
12. [故障模式与覆盖](#12-故障模式与覆盖)
13. [测试覆盖需求](#13-测试覆盖需求)
14. [CI/CD 与镜像策略](#14-cicd-与镜像策略)

附录 A. [架构决策记录（ADR）](#附录-a-架构决策记录adr)
附录 B. [工程审计报告](#附录-b-工程审计报告)

---

## 1. 总体拓扑

```
          ┌─────────────────────────────────────────────┐
          │            顾客（全球访客）                     │
          └──────────────────┬──────────────────────────┘
                             │ HTTPS
          ┌──────────────────▼──────────────────────────┐
          │  Cloudflare（免费 CDN + DDoS 防护 + 隐藏 IP）  │  ← 全球边缘缓存
          │  静态资源在此终止；动态请求回源 VPS             │
          └──────────────────┬──────────────────────────┘
                             │ 回源 (443)
          ┌──────────────────▼──────────────────────────┐
          │  Caddy (反代 + 终端 TLS)                      │  ← VPS 唯一对外端口
          │  shop./api./admin. 域名分流                   │
          └─────┬─────────────┬──────────────┬──────────┘
                │             │              │
   ┌────────────▼──┐  ┌───────▼────────┐  ┌──▼──────────────────┐
   │ Storefront     │  │ Medusa Server  │  │ Medusa Worker        │
   │ Next.js (SSR) │  │ REST+Admin API │  │ 队列消费/定时任务     │
   │ Node standalone│  │ /app (admin)   │  │ (同一镜像,worker模式) │
   └───────────────┘  └──┬──────────┬───┘  └──────────┬──────────┘
                         │          │                  │
          ┌──────────────▼──┐ ┌────▼─────────┐ ┌──────▼──────────────┐
          │  PostgreSQL     │ │    Redis     │ │  Cloudflare R2       │
          │  商品/订单/客户  │ │ 队列/缓存/事件│ │  商品图/媒体(云端)   │
          │  (每日 pg_dump   │ │ maxmemory限  │ │  免费10GB+CDN        │
          │   → R2 异地备份) │ │  256mb+LRU  │ │                      │
          └─────────────────┘ └──────────────┘ └─────────────────────┘
                │
          ┌─────▼───────────────────────────┐
          │  外部 SaaS（仅这些有外部依赖）    │
          │  Stripe / PayPal / Resend(邮件) │
          │  / Stripe Tax / ShipStation      │
          │  / GHCR (镜像 registry)          │
          └──────────────────────────────────┘

          ↑ VPS 内全部服务（Hetzner CAX21, 美区）↑
            镜像: CI 构建推 GHCR → VPS pull（不在 VPS 上 build）
            Staging: 同机隔离 compose project，不同端口
```

### 核心设计原则

1. **Server 与 Worker 分进程** — 同镜像不同命令。Medusa 官方要求生产跑两个进程：主 Server 处理 API 请求，Worker 消费 Redis 队列做异步任务（订单确认邮件、库存扣减、定时同步）。单进程会在流量上来后拖垮 API 响应。
2. **Cloudflare → Caddy 两层** — CF 边缘缓存静态 + 隐藏 IP + DDoS 防护；Caddy 终端 TLS（CF 代理开启时用 CF Origin 证书，灰云模式时 Caddy 自签 Let's Encrypt）。
3. **对象存储走 R2** — 商品图不落 VPS 磁盘，VPS 故障不丢图；R2 自带 CDN 加速。
4. **镜像不在 VPS 构建** — CI build → GHCR → VPS pull，避免 4GB ARM OOM，支持回滚。
5. **同机 staging** — 隔离 compose project 跑在不同端口，发版前先验。
6. **Caddy 唯一对外入口** — PG/Redis 端口不暴露公网，只 Docker 内网互通。

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|----|------|------|
| 后端引擎 | **Medusa v2.21+**（MIT, Node 22 LTS） | 单一 TypeScript 栈，模块化，Stripe 官方模块，**无 GMV 抽成** |
| 店面 | **Next.js Starter**（App Router, 官方） | `create-medusa-app` 拉成 monorepo（自 v2.14 起标准方式），Stripe/PayPal 接好 |
| 数据库 | **PostgreSQL 15+** | Medusa 唯一支持的主库，订单/商品/客户 |
| 缓存/队列 | **Redis 7** | 工作流引擎、缓存、事件总线——生产强制依赖 |
| 对象存储 | **Cloudflare R2**（主存储）/ MinIO 仅本地开发 | R2 免费 10GB + 自带 CDN，商品图持久不丢；本机 MinIO 只用于 dev |
| 前端 | **Next.js standalone**（同机自托管） | `next start` Node 进程，省 Vercel 费；ISR 在同机跑 |
| 后端托管 | **VPS + Docker Compose**（Hetzner CAX21 美区） | 单机全栈，~$4/月，开源省成本核心 |
| 反代/SSL/CDN | **Cloudflare（免费）→ Caddy 2** | CF 边缘缓存+隐藏 IP+DDoS 防护；Caddy 终端 TLS |
| CI/CD | GitHub Actions → build → push GHCR → VPS pull | CI 构建避免 VPS OOM；支持镜像回滚 |
| 监控 | UptimeRobot（免费 50 点）+ Sentry（免费 5K 事件） | Medusa 无内置 APM，用免费层 |

---

## 3. 目录结构（monorepo）

`create-medusa-app@latest` 生成的结构：

```
D:\Claude\B2Csite\
├── apps/
│   ├── backend/              # Medusa 服务端
│   │   ├── src/
│   │   │   ├── api/          # 自定义 REST 端点
│   │   │   ├── modules/      # 自定义模块（如自有物流）
│   │   │   ├── subscribers/  # 事件订阅（订单创建→发邮件）
│   │   │   ├── workflows/    # 业务工作流（结账/退款）
│   │   │   └── jobs/         # 定时任务
│   │   ├── medusa-config.ts  # 模块/插件/支付 provider 注册
│   │   ├── Dockerfile        # 生产镜像（CI 构建）
│   │   └── .env              # DB_URL / REDIS_URL / STRIPE_API_KEY ...
│   └── storefront/           # Next.js 店面
│       ├── app/[countryCode]/# 多区域路由
│       ├── Dockerfile        # 生产镜像（next standalone）
│       ├── .env.local        # MEDUSA_BACKEND_URL / NEXT_PUBLIC_STRIPE_KEY / NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
│       └── ...
├── packages/                 # 共享类型/UI（可选）
├── .github/
│   └── workflows/
│       └── build.yml         # CI: build → push GHCR
├── docs/
│   └── architecture.md       # 本文档
├── .nvmrc                    # 锁 Node 22 LTS
├── docker-compose.yml        # 本地开发: pg + redis + minio
├── docker-compose.prod.yml   # 生产: 从 GHCR pull 镜像
├── docker-compose.staging.yml# 同机 staging
└── Caddyfile                 # 反代配置
```

---

## 4. 部署架构

### 4.1 进程拆分（强制）

| 进程 | 职责 | 数量 |
|------|------|------|
| `medusa` (server) | 处理 Store API + Admin API | 1+（可水平扩展） |
| `medusa worker` | 消费队列、定时任务 | 1（重负载可加） |

两进程用**同一个 Docker 镜像**，启动命令不同：
- Server: `medusa start`
- Worker: `medusa start --worker`

### 4.2 最低配置（官方推荐）

| 资源 | 最低 | 推荐 |
|------|------|------|
| RAM (medusa) | 1 GB | 2 GB+（admin 构建吃内存） |
| CPU | 0.5 vCPU | 1+ vCPU |
| PostgreSQL | 256MB / 1GB 磁盘 | 1GB / 10GB+ |
| Redis | 256MB | 512MB+ |
| Node.js | 20+ | 22 LTS |

### 4.3 推荐 VPS 配置

| 级别 | 规格 | 月费 | 来源 |
|------|------|------|------|
| **起步（CAX21）** | 4 vCPU ARM / 8GB RAM / 80GB | €3.39/mo | Hetzner Cloud (ARM) |
| **舒适（CAX31）** | 8 vCPU ARM / 16GB RAM / 160GB | €6.49/mo | Hetzner Cloud (ARM) |
| 替代 | 6 vCPU / 16GB / 400GB | ~$6/mo | Contabo VPS S |

> ⚠️ 型号确认：CAX21 = 4C/8GB ARM（€3.39）。CX 系列是 x86 且规格不同（CX22 仅 2C/4GB）。下单认准 **CAX** 系列。
> 8GB RAM 足以单机跑：Medusa server + worker + PostgreSQL + Redis（对象存储走 R2，不占本机）。
> **地域**：VPS 选美区节点（美东 Ashburn / 美西 Hillsboro），离 Stripe/顾客近，且法律上数据落美国。
> **镜像构建不在 VPS 上做** — CI 构建推 GHCR，VPS 只 pull（见 §14）。

### 4.4 本地开发环境

```yaml
# docker-compose.yml（本地开发）
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: medusa
      POSTGRES_PASSWORD: medusa
      POSTGRES_DB: medusa
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
volumes: { pgdata: {}, miniodata: {} }
```

### 4.5 生产 Docker Compose

```yaml
# /opt/b2csite/docker-compose.prod.yml（生产）
# 镜像: CI 构建推 GHCR，VPS 只 pull（不在 VPS 上 build，避免 OOM）
services:
  medusa:
    image: ghcr.io/<owner>/b2c-backend:latest
    env_file: ./apps/backend/.env.prod
    restart: unless-stopped
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  medusa-worker:
    image: ghcr.io/<owner>/b2c-backend:latest
    command: ["medusa", "start", "--worker"]
    env_file: ./apps/backend/.env.prod
    restart: unless-stopped
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
  storefront:
    image: ghcr.io/<owner>/b2c-storefront:latest
    env_file: ./apps/storefront/.env.prod
    restart: unless-stopped
    depends_on:
      medusa: { condition: service_healthy }
  postgres:
    image: postgres:15-alpine
    env_file: ./.env.db
    volumes: [pgdata:/var/lib/postgresql/data]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U medusa"]
      interval: 10s
      timeout: 5s
      retries: 5
  redis:
    image: redis:7-alpine
    command: redis-server --save 60 1 --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes: [redisdata:/data]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddydata:/data", "caddyconfig:/config"]
    restart: unless-stopped
    depends_on:
      medusa: { condition: service_healthy }
      storefront: { condition: service_started }
volumes: { pgdata: {}, redisdata: {}, caddydata: {}, caddyconfig: {} }
```

**关键配置点：**
- **无 MinIO** — 对象存储走 R2，后端配 S3-compatible 指向 R2 endpoint。
- **`image:` 而非 `build:`** — 镜像从 GHCR pull，VPS 不编译。
- **healthcheck + depends_on** — Caddy 在 Medusa healthy 后启动，避免启动期 502。
- **Redis maxmemory 256mb + allkeys-lru** — 防止队列积压吃光内存拖垮 PG。

### 4.6 Caddyfile

Cloudflare 在前，Caddy 终端 TLS：
- Cloudflare DNS 指向 VPS，CF 代理开启（橙云）→ 用 CF Origin Certificate
- `shop.yourdomain.com` → `storefront:8000`
- `api.yourdomain.com` → `medusa:9000`
- `admin.yourdomain.com` → `medusa:9000/app`（加 `basic_auth` 强密码，不依赖静态 IP 白名单）

### 4.7 同机 Staging

同一 VPS，隔离 compose project，不同端口（不对外，只走 Caddy 内网或 SSH 隧道）：

```bash
# /opt/b2csite-staging/docker-compose.staging.yml
# 复用同一镜像，不同 .env（staging DB / staging Stripe key）
# 端口: medusa:9100, storefront:8100, postgres:5433
docker compose -p b2cstaging pull && docker compose -p b2cstaging up -d
```

发版流程：push → CI build → GHCR → 先在 staging pull 验证 → 通过后 prod pull。

### 4.8 自托管运维责任

| 项 | 措施 |
|----|------|
| PG 备份 | cron + `pg_dump` 每日 → 上传 R2 + 本地保留 7 份轮转 |
| Redis 持久化 | `--save 60 1 --appendonly yes`（AOF）+ maxmemory 限制 |
| 对象存储备份 | R2 本身持久（3 副本），无需额外备份 |
| SSL | Caddy 自动（CF 代理开启时用 CF Origin 证书） |
| 防火墙 | UFW 只开 22/80/443；PG/Redis 不对外，只 Docker 内网通 |
| 监控 | UptimeRobot 免费 50 监控点；Sentry 免费层（5K 事件/月） |
| 安全更新 | unattended-upgrades 自动装安全补丁 |
| DB 迁移 | 每次 Medusa 版本升级后跑 `medusa db:migrate`（部署步骤必含） |
| Deploy key 安全 | GitHub Actions SSH key 用 force-command 限制只能执行 pull+up |

---

## 5. 支付链路（三段式）

```
① 收单(Checkout)        ② 收款账户(Account)        ③ 结汇(Settlement)
┌──────────────┐        ┌──────────────┐          ┌──────────────┐
│ 顾客信用卡   │──Stripe│ Stripe USD   │──ACH T+2─│ 美国银行账户  │
│ PayPal       │──PayPal│ 余额         │          │ (Mercury/WF) │
└──────────────┘        └──────────────┘          └──────┬───────┘
                                                          │
                                                 ┌────────▼────────┐
                                                 │ WorldFirst /    │
                                                 │ PingPong        │
                                                 │ USD → CNY       │
                                                 └────────┬────────┘
                                                          │
                                                 ┌────────▼────────┐
                                                 │ 国内对公人民币账户│
                                                 └─────────────────┘
```

### 5.1 收单段（Checkout）— Medusa 内

- **Stripe Module Provider**：Medusa 后端 `medusa-config.ts` 注册，默认随 `create-medusa-app` 安装。
  - 后端 env: `STRIPE_API_KEY`（secret key）
  - 店面 env: `NEXT_PUBLIC_STRIPE_KEY`（publishable key）
  - 用 **Stripe Payment Element**（托管卡组件）→ **服务器永不接触卡号**，PCI 范围降到 SAQ-A。
- **PayPal Provider**：第二按钮，跳出 PayPal 结账页。~4%+ 成本，但带来买家信任、降低弃单率。
- **Publishable API Key**：店面每个 Store API 请求必须带 `x-publishable-api-key` 头（v2 默认创建，Admin → Settings → Publishable API Keys 查）。

### 5.2 收款账户段（Account）

- Stripe 美区账户 → **T+2 自动 payout 到美国银行账户**（ACH）。
- 美国银行账户选 **Mercury**（数字银行，对跨境友好）或 **Wise Business** / **Chase**。
- Stripe 内设 **最低保留余额**（如 $500）覆盖退款/拒付，防止负余额。
- ⚠️ **关键假设待验证**：WorldFirst/PingPong 给的美国 ACH 账号能否直接作 Stripe payout 目标。Stripe 通常要求账户名与商户名一致，第三方代收账户可能被拒。开户前用小额测试打款验证。

### 5.3 结汇段（Settlement → CNY）

- 美国账户收到 USD 后，用 **WorldFirst / PingPong** 结汇到国内对公 CNY。
- **预期路径**（待验证）：WorldFirst/PingPong 给的美国 ACH 账号直接作 Stripe payout 目标 → 跳过中间银行。
- 选型：
  - **WorldFirst**（万里汇，蚂蚁旗下）：费率低、到账快、1688 直付供应商。
  - **PingPong**：HK 上市系，50 州 MTL 牌照，适合多平台收款。
  - **Airwallex**：能力全，但需确认 AUSTRAC 外部审计状态后再开户。

### 5.4 费率与风控红线

| 项 | 数值 |
|----|------|
| Stripe 美国卡费率 | 2.9% + $0.30 |
| PayPal | ~3.49% + 固定费（按币种） |
| WorldFirst/PingPong 结汇 | ~0.3-1%（看渠道） |
| **拒付率红线** | **~1%**（卡组织阈值，比费率更要命——超 1% 会被 Stripe 关户） |

风控措施：Stripe Radar（开规则）+ 地址验证（AVS）+ 3DS（欧盟 Strong Customer Authentication 强制）+ 高风险订单人工复核。

---

## 6. 税务合规

| 区域 | 义务 | 方案 |
|------|------|------|
| **美国（销售税）** | 经济关联阈值（各州 $100K 销售额或 200 笔交易）触发 nexus → 收税 | Stripe Tax 自动按州税率计算；Medusa 区域税率配置；阈值达标才收 |
| **欧盟（VAT）** | 非 EU 卖家，≤€150 包裹走 **IOSS**，结账时收 VAT；2026年7月起同时收 €3 关税 | 申请 IOSS 号（任一 EU 国）；Medusa 结账按区域加 VAT；月度申报 |
| **英国（VAT）** | ≤£135 由卖家在结账收 VAT | Stripe Tax 覆盖 UK VAT |
| **加拿大（GST/HST）** | 阈值触发 | Stripe Tax 覆盖 |

**Stripe Tax 接入**：在结账 workflow 里调用 Stripe Tax API 算税，或用 Medusa 内置税率表 + 区域配置。IOSS 单独处理（结账时按收货国 VAT 率加价，并在包裹单据上标 IOSS 号）。

---

## 7. 区域 / 货币 / 目录

Medusa 原生支持多区域（region），每个 region 绑定：
- 货币（USD / EUR / GBP ...）
- 税率
- 支付 provider（region 级开关——美国区只显 Stripe，德国区显 Stripe+PayPal+Klarna）
- 履运选项

```
Region: US   → USD, Stripe + PayPal, 免税阈值内
Region: EU   → EUR, Stripe + PayPal, IOSS VAT
Region: UK   → GBP, Stripe + PayPal, VAT
Region: Global-USD → 其他地区统一 USD
```

多货币：Stripe 自动货币转换（多币种 settlement），或前端按区域切换显示价。起步建议**先单 USD 全球卖**，再按市场拆 region。

---

## 8. 安全

| 维度 | 措施 |
|------|------|
| **PCI 合规** | Stripe Payment Element 托管 → SAQ-A，服务器不碰卡数据 |
| **密钥管理** | 后端 `.env.prod`（VPS 本地，权限 600）；**永不提交进 git**；`STRIPE_API_KEY`、`DATABASE_URL`、`JWT_SECRET`、`R2_ACCESS_KEY` 等 |
| **Storefront API 防护** | Publishable API Key（只读 storefront 端点）；Admin API 不暴露给前端 |
| **Admin 后台** | Caddy `basic_auth` 强密码（不依赖静态 IP 白名单，家用宽带 IP 动态） |
| **CORS** | `medusa-config.ts` 限制 `store_cors`/`admin_cors` 为你的域名 |
| **HTTPS** | Cloudflare 边缘 TLS + Caddy 终端 TLS（CF Origin 证书） |
| **依赖安全** | `npm audit` / Dependabot 自动 PR |
| **数据库备份** | cron 每日 `pg_dump` → 上传 R2 + 本地 7 份轮转 |
| **防火墙** | UFW 只开 22/80/443；PG/Redis 不对外，只 Docker 内网 |
| **Webhook 安全** | Stripe/PayPal webhook 验签（防伪造回调）；重复 webhook 幂等处理 |

---

## 9. 成本预估（月）— VPS 自托管路线

| 项 | 起步(CAX21) | 舒适(CAX31) | 说明 |
|----|------------|-----------|------|
| **VPS（全栈单机）** | **€3.39 (~$4)** | **€6.49 (~$7)** | Hetzner：server+worker+PG+Redis 全在这台（对象存储走 R2 不占本机） |
| 对象存储 R2 | $0 | $0 | 免费 10GB + CDN（商品图走这里） |
| 前端 | $0 | $0 | Next.js 同机自托管（Node standalone） |
| 域名 | ~$1 | ~$1 | |
| 邮件(Resend) | $0(免费3K封) | $20 | 起步用 Resend 免费层；月单量超 ~1500 单需升级 |
| Cloudflare | $0 | $0 | 免费 CDN + DDoS 防护 |
| GHCR | $0 | $0 | GitHub Container Registry 对私有镜像免费（公开无限） |
| **基础设施合计** | **~$5/月** | **~$28/月** | |
| — 交易费（按笔） | Stripe 2.9%+$0.30 / PayPal ~4% | 同 | 从成交额抽，非固定成本 |
| — 结汇费（按额） | WorldFirst/PingPong ~0.3-1% | 同 | 从结汇额抽 |
| — Medusa 抽成 | **$0** | **$0** | 开源无 GMV 抽成 |

> **核心：固定基础设施压到 ~$5/月**（一台 Hetzner CAX21）。其余全是按交易量抽的变动成本——没成交就没成本。比 Railway ~$35/月 省 85%+，比 Shopify $39+/月基础费还低且无 GMV 抽成。

---

## 10. 落地步骤

1. **本地起骨架**
   - 装 Git for Windows + Docker Desktop
   - **锁 Node 22 LTS**（本机 v24 偏新有风险）：用 nvm-windows `nvm install 22.11.0 && nvm use 22.11.0`，或直接用 Docker dev 环境
   - `npx create-medusa-app@latest b2c-site` → 生成 monorepo（backend + storefront）
   - `docker compose up -d`（依赖服务：pg/redis/minio 仅本地 dev）
   - `npm dev` → Admin (`:9000/app`) + Storefront (`:8000`) 跑通

2. **接 Stripe（测试模式）**
   - Stripe Dashboard 拿 test publishable/secret key
   - 后端 `.env`: `STRIPE_API_KEY=sk_test_...`
   - 店面 `.env.local`: `NEXT_PUBLIC_STRIPE_KEY=pk_test_...`
   - 确认 `medusa-config.ts` 已注册 `@medusajs/medusa-payment-stripe`
   - Admin → 启用 Stripe provider for US region
   - 跑一笔测试 checkout（测试卡 `4242 4242 4242 4242`）

3. **接 PayPal**（同上，`@medusajs/medusa-payment-paypal`）

4. **配多区域 + 税率**
   - Admin → Regions → 建 US / EU / UK
   - 绑定支付 provider、货币、运费
   - Stripe Tax 接入或手动税率表

5. **对象存储**：后端配 S3-compatible 指向 R2（R2 endpoint + access key/secret），商品图走 R2 CDN

6. **邮件**：接 Resend（订单确认/发货通知 subscriber）

7. **配 CI/CD + 镜像 registry**
   - GitHub Actions workflow：push → build backend + storefront 镜像 → push GHCR
   - Dockerfile for backend（Node 22 + medusa）和 storefront（next standalone）

8. **部署生产（VPS 自托管）**
   - 开 Hetzner **CAX21**（美区，Ubuntu 24.04）⚠️ 不是 CX22
   - 装 Docker + docker-compose-plugin + UFW（只开 22/80/443）
   - 把 Cloudflare DNS 指向 VPS IP，CF 代理开启（橙云）
   - `git clone` repo 到 `/opt/b2csite`，写 `.env.prod`（生产 secrets）
   - `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`
   - **跑 `medusa db:migrate`**（首次部署 + 每次升级必做）
   - 配 Caddyfile（shop/api/admin 三域名反代，admin 加 `basic_auth`）
   - 设 cron 每日 `pg_dump` + 上传 R2；unattended-upgrades 开
   - Stripe 切 live key；WorldFirst 美国账号作 payout 目标（**先验证 Stripe 接受非商户名账户**）
   - CORS 在 `medusa-config.ts` 锁为生产域名

9. **Staging 验证流程**
   - 同机起 `docker compose -p b2cstaging pull && up -d`（隔离 DB + 端口）
   - 先在 staging 验证新镜像，通过后再 prod pull

10. **合规收尾**
    - 美国销售税阈值监控
    - EU IOSS 申请 + 结账 VAT 逻辑
    - 拒付率监控仪表盘

---

## 11. 待确认 / 尽调备忘

- [ ] 美国公司具体州（影响销售税 nexus 注册州、Stripe 账户地址）
- [ ] **WorldFirst/PingPong 美国账号能否直接作 Stripe payout 目标**（关键假设，Stripe 可能要求账户名与商户名一致——开户前用测试打款验证）
- [ ] WorldFirst vs PingPong 选哪个（取决于你的国内主体）
- [ ] Airwallex AUSTRAC 外部反洗钱审计状态（2026年1月起）— 开户前核实
- [ ] 是否需要 Klarna/Afterpay（先付后用）— 欧美 DTC 常见，可后加
- [ ] 物流履约集成（ShipStation / EasyShip）— 跨境发货标签
- [ ] VPS 是否已有？若无，开 Hetzner CAX21 美区（€3.39/月，4C/8G/80G）
- [ ] 域名是否已有？（shop./api./admin. 三个子域）

---

## 12. 故障模式与覆盖

| 故障 | 用户看到 | 覆盖 | 评级 |
|------|---------|------|------|
| VPS 磁盘故障 | 店不可访问 | PG 备份到 R2 ✓ / 商品图在 R2 ✓ | 非 critical |
| Stripe webhook 未送达 | 订单已付款但系统未确认 | **无测试 + 无重试 → silent** | **🔴 critical gap** |
| Redis 队列积压 | 邮件/履约延迟 | maxmemory 限制 ✓ / 无队列积压告警 | 非 critical |
| Caddy 在 Medusa 前启动 | 启动期 502 | healthcheck + depends_on ✓ | 已修复 |
| DB 迁移遗漏 | Medusa 启动失败 | 部署步骤已含 db:migrate | 非 critical（流程覆盖） |
| WorldFirst payout 被拒 | 资金无法到账 | **假设未验证 → 待测** | 待验证 |

**Critical gaps: 1**（Stripe webhook 无重试/幂等测试）— 上线前必须补。

---

## 13. 测试覆盖需求

上线前必须覆盖的关键路径：

```
CODE PATHS                                              USER FLOWS
[+] checkout workflow (Medusa)                         [+] 完整结账 [→E2E]
  ├── [GAP] Stripe 支付成功                              ├── [GAP] [→E2E] 下单→支付→订单确认
  ├── [GAP] Stripe 支付失败(拒卡)                         ├── [GAP] [→E2E] 双击提交
  └── [GAP] PayPal 回调验证                                ├── [GAP] 支付中途关闭页面
[+] order subscriber (邮件)                             └── [GAP] 超时重试
  └── [GAP] 订单创建→Resend 发信
[+] webhook 处理 (Stripe/PayPal)
  ├── [GAP] 签名验证
  └── [GAP] 重复 webhook 幂等   ← CRITICAL

COVERAGE: 0/7 paths tested (0%)  |  GAPS: 7 (4 E2E)
```

每个 GAP 需在实现阶段补测试，webhook 幂等为 P0 阻塞项。

---

## 14. CI/CD 与镜像策略

### 为什么不在 VPS 上 build

4GB ARM VPS 构建 Medusa（尤其 admin build 吃 2GB+ 内存）会 OOM。CI 构建不受 VPS 内存限制，且支持镜像回滚。

### 流程

```
git push → GitHub Actions
  ├── build backend image (Node 22 + medusa)  → push ghcr.io/<owner>/b2c-backend:latest
  └── build storefront image (next standalone) → push ghcr.io/<owner>/b2c-storefront:latest

VPS 部署:
  docker compose -p b2cstaging pull  (staging 验证)
  docker compose -p b2cstaging up -d
  ↓ 验证通过
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml up -d
  medusa db:migrate  (如有 schema 变更)
```

### Deploy key 安全

GitHub Actions SSH key 用 `force-command` 限制只能执行 `docker compose pull && up -d`，不能获得完整 shell。替代方案：pull-based（VPS cron 定时拉 ghcr 最新镜像）。

---

## 附录 A. 架构决策记录（ADR）

### ADR-1: 对象存储用 R2 而非本机 MinIO（2026-10-10）

**决策**：Cloudflare R2 做主对象存储，MinIO 仅用于本地开发。
**理由**：商品图是核心资产。MinIO-only 方案在 VPS 磁盘故障时丢失全部商品图。R2 免费 10GB + 自带 CDN，数据持久（3 副本）。
**Completeness**: 9/10。

### ADR-2: 镜像在 CI 构建推 GHCR，不在 VPS build（2026-10-10）

**决策**：GitHub Actions 构建镜像推 GHCR，VPS 只 pull。
**理由**：4GB ARM VPS 构建 Medusa 几乎必 OOM（admin build 吃 2GB+）。CI 构建不受限，支持回滚到旧镜像。
**Completeness**: 9/10。

### ADR-3: Cloudflare CDN 在 Caddy 前（2026-10-10）

**决策**：Cloudflare 免费层做边缘缓存，Caddy 做终端 TLS 反代。
**理由**：跨境 DTC 面向全球顾客，裸 Caddy 直连美区 VPS 会让欧洲/亚洲顾客跨洋慢。CF 免费提供全球边缘节点 + DDoS 防护 + 隐藏 VPS IP。
**Completeness**: 9/10。

### ADR-4: 同机 staging compose project（2026-10-10）

**决策**：同一 VPS 跑隔离 staging compose project，不同端口。
**理由**：处理支付的店不能从本地 dev 直发生产。同机隔离几乎零额外成本（共享 8GB RAM），发版前先验。
**Completeness**: 8/10。

---

## 附录 B. 工程审计报告

> 由 `/plan-eng-review`（gstack）于 2026-10-10 执行。审计结果已反映在正文修订中。

### 审计范围
- 目标：`D:\Claude\B2Csite\docs\architecture.md`（架构方案，无代码）
- 模式：FULL_REVIEW（scope accepted as-is，架构方案无代码可裁剪）

### 发现汇总

| 章节 | 发现数 | 已修 | 留待 |
|------|--------|------|------|
| Architecture | 9 | 7 | 2（WorldFirst 验证 / webhook 测试） |
| Code Quality | 3 | 3 | 0 |
| Test | 7 gaps | — | 7（实现阶段补） |
| Performance | 2 | 2 | 0 |
| **合计** | **14 issues + 7 test gaps** | **12** | **9** |

### 已修复的关键问题

1. VPS 型号 CX22 → CAX21（2C/4GB → 4C/8GB ARM）
2. VPS build OOM → CI build 推 GHCR
3. 无 healthcheck → 全服务加 healthcheck + depends_on
4. MinIO 无异地备份 → R2 主存储
5. 无 staging → 同机 staging compose
6. 无 CDN → Cloudflare 在 Caddy 前
7. admin IP 白名单 → basic_auth 强密码
8. Redis 无上限 → maxmemory 256mb + allkeys-lru
9. 无 db:migrate 步骤 → 部署步骤显式加入
10. Node v24 vs 22 不一致 → 锁 22 LTS
11. deploy key 安全 → force-command
12. 安全章节过时引用 → 全部改为 VPS/R2/Caddy/CF

### Critical gap（上线前必补）

**Stripe/PayPal webhook 幂等 + 重试测试** — webhook 丢失会导致订单已付款但系统未确认（silent failure）。这是唯一的 critical gap。

### 关键假设待验证

**WorldFirst 美国账号能否直接作 Stripe payout 目标** — Stripe 通常要求账户名与商户名一致。第三方代收账户可能被拒。开户前用小额测试打款验证。

### 审计状态

- Outside voice: codex unavailable（Windows 环境，无 Codex CLI）
- Lake Score: 4/4（全部选了 9/10 completeness 选项）
- Parallelization: 1 lane（单 monorepo，无并行机会）

### GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | /plan-ceo-review | Scope & strategy | 0 | — | not run |
| Outside Review | codex-plan-review | Independent 2nd opinion | 0 | unavailable | Windows env, no Codex CLI |
| Eng Review | /plan-eng-review | Architecture & tests (required) | 1 | ISSUES OPEN | 14 issues, 1 critical gap |
| Design Review | /plan-design-review | UI/UX gaps | 0 | — | not run |
| DX Review | /plan-devex-review | Developer experience gaps | 0 | — | not run |

**OUTSIDE COVERAGE:** provider=codex, phase=plan-review, unavailable (Windows host, Codex CLI not installed).

**VERDICT:** ENG REVIEW ISSUES OPEN — architecture solid, 14 issues found and 12 fixed in-doc, 1 critical gap (webhook idempotency testing) must be addressed before accepting live payments. eng review required.

**UNRESOLVED DECISIONS:**
- Stripe/PayPal webhook 幂等 + 重试测试（critical gap，上线前必补）
- WorldFirst 账号作 Stripe payout 目标的关键假设需实测验证
