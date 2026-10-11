# B2Csite｜Medusa 自托管电商项目

本仓库用于规划和逐步构建一个基于 **Medusa v2** 的跨境 DTC 独立电商站。当前 Windows `main` 分支主要是架构与学习文档，**尚不是可直接部署的完整应用**。

## 目标部署路线

- **电商后端与管理后台**：Medusa。后端提供商品、购物车、订单等业务 API；Medusa Admin 供商家管理商品和订单。
- **顾客店面**：Next.js Storefront，与 Medusa 后端分开开发和部署，通过 Store API 通信。
- **运行方式**：VPS + Docker Compose；计划将 Medusa Server 和 Worker 分开运行。
- **数据服务**：PostgreSQL 与 Redis 先计划自托管在 VPS；商品图片计划使用 S3 兼容对象存储（当前方向为 Cloudflare R2）。
- **构建发布**：GitHub Actions 检查并构建项目 Docker 镜像，推送到 GHCR，再由 VPS 拉取和运行。

以上是**目标架构，不代表已经搭建或验证**。正式选择的业务服务、资源规格、域名和生产配置仍需在实施前确认。

## 文档导航

- [部署架构方案](docs/architecture.md)：组件职责、网络与数据流、发布、备份、隔离和待确认事项。
- [Medusa 小白学习手册](docs/medusa-learning-guide.md)：用通俗语言理解 Medusa、Storefront/Admin、模块、工作流和部署流程。

## 从哪里开始

建议先阅读学习手册中“Medusa 是什么”，再看部署架构。实际开发应从官方脚手架生成项目后，按对应 Medusa 版本验证 Node.js 要求、构建命令、模块配置和迁移流程；不要把本方案文档中的示意配置直接当成已验证的生产配置。

## 安全提示

不要将 `.env`、支付密钥、数据库密码、JWT 密钥、对象存储密钥或真实顾客数据提交到 Git。发布凭据使用 GitHub Secrets 或服务器安全配置；生产与测试环境应使用不同的密钥和数据。
