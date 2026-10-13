# B2Csite｜Medusa 自托管电商项目

本项目旨在构建一个基于 **Medusa v2** 的跨境 DTC 独立电商站。

## 架构概览

- **电商后端与管理后台**：Medusa。后端提供商品、购物车、订单等业务 API；Medusa Admin 供商家管理商品和订单。
- **顾客店面**：Next.js Storefront，与 Medusa 后端分开开发和部署，通过 Store API 通信。
- **运行方式**：VPS + Docker Compose；Medusa Server 和 Worker 分开运行。
- **数据服务**：PostgreSQL 与 Redis 自托管；商品图片使用 S3 兼容对象存储。
- **构建发布**：GitHub Actions 构建 Docker 镜像并推送到 GHCR，由 VPS 拉取和运行。

## 仓库目录

```text
apps/
  backend/       Medusa 后端与 Admin
  storefront/    Next.js 顾客店面
docs/            架构方案与学习手册
infra/local/     本地 Docker Compose 与环境变量模板
.github/         GitHub Actions CI / 镜像发布
```

根目录的 `package.json`、`package-lock.json`、`turbo.json` 和 Node/npm 配置用于管理两个 workspace 与统一构建；Docker 镜像的构建上下文也保持在仓库根目录。

## 本地容器

本地 Compose 配置位于 `infra/local/compose.yaml`。复制 `infra/local/.env.example` 为 `infra/local/.env.local`，将 `POSTGRES_PASSWORD` 设为 64 位十六进制值（可用 `openssl rand -hex 32` 生成），并填写其他仅供本机使用的配置后，在仓库根目录执行：

```sh
docker compose --env-file infra/local/.env.local -f infra/local/compose.yaml up --build
```

Compose project 名固定为 `b2csite-local`，用于沿用现有 `b2csite-local_pgdata` PostgreSQL 数据卷。停止服务时不要添加 `-v`，以免删除数据库数据。详细说明见[架构文档](docs/architecture.md#24-本地容器化基线-2026-10-12)。

## 文档导航

- [部署架构方案](docs/architecture.md)：组件职责、网络与数据流、发布、备份、隔离和待确认事项。
- [Medusa 小白学习手册](docs/medusa-learning-guide.md)：用通俗语言理解 Medusa、Storefront/Admin、模块、工作流和部署流程。

## 从哪里开始

建议先阅读[Medusa 小白学习手册](docs/medusa-learning-guide.md)，再查看[部署架构方案](docs/architecture.md)。

## 安全提示

不要将 `.env`、支付密钥、数据库密码、JWT 密钥、对象存储密钥或真实顾客数据提交到 Git。发布凭据使用 GitHub Secrets 或服务器安全配置；生产与测试环境应使用不同的密钥和数据。
