# B2Csite — 跨境 DTC 独立电商站

基于 [Medusa v2](https://medusajs.com/) 的 B2C 跨境 DTC 独立电商站，自托管部署，面向全球市场。

## 概述

| 项 | 值 |
|----|-----|
| 后端引擎 | Medusa v2.21+（MIT，自托管，无 GMV 抽成） |
| 店面 | Next.js Starter（官方 App Router） |
| 收单 | Stripe（主）+ PayPal（次） |
| 结汇 | USD → WorldFirst/PingPong → CNY |
| 部署 | VPS 单机全栈 Docker Compose（Hetzner CAX21 美区 ARM） |
| 对象存储 | Cloudflare R2（免费 10GB + CDN） |
| CDN | Cloudflare 免费层 |
| 月固定成本 | ~$5（无成交则无变动成本） |

## 文档

- [技术架构文档](docs/architecture.md) — 完整架构、部署、支付、安全、成本、落地步骤

## 本地开发

### 前置要求

- [Node.js 22 LTS](https://nodejs.org/)（用 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理）
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（WSL2 后端）
- [Git](https://git-scm.com/)

### 起步

```bash
# 1. 安装依赖服务（PostgreSQL + Redis + MinIO）
docker compose up -d

# 2. 脚手架（首次，生成 monorepo）
npx create-medusa-app@latest b2c-site

# 3. 启动后端 + 店面
cd apps/backend && npm run dev      # Medusa :9000 + Admin /app
cd apps/storefront && npm run dev   # Storefront :8000
```

## 生产部署

```bash
# VPS 上（镜像从 GHCR pull，不在 VPS 上 build）
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
npx medusa db:migrate    # 有 schema 变更时
```

详见 [技术架构文档 §10 落地步骤](docs/architecture.md#10-落地步骤)。

## License

Private / proprietary.
