# B2Csite｜Medusa 自托管电商项目

本项目旨在构建一个基于 **Medusa v2** 的跨境 DTC 独立电商站。

## 架构概览

- **电商后端与管理后台**：Medusa。后端提供商品、购物车、订单等业务 API；Medusa Admin 供商家管理商品和订单。
- **顾客店面**：Next.js Storefront，与 Medusa 后端分开开发和部署，通过 Store API 通信。
- **运行方式**：VPS + Docker Compose；Medusa Server 和 Worker 分开运行。
- **数据服务**：PostgreSQL 与 Redis 自托管；商品图片使用 S3 兼容对象存储。
- **构建发布**：GitHub Actions 构建 Docker 镜像并推送到 GHCR，由 VPS 拉取和运行。

## 文档导航

- [部署架构方案](docs/architecture.md)：组件职责、网络与数据流、发布、备份、隔离和待确认事项。
- [Medusa 小白学习手册](docs/medusa-learning-guide.md)：用通俗语言理解 Medusa、Storefront/Admin、模块、工作流和部署流程。

## 从哪里开始

建议先阅读[Medusa 小白学习手册](docs/medusa-learning-guide.md)，再查看[部署架构方案](docs/architecture.md)。

## 安全提示

不要将 `.env`、支付密钥、数据库密码、JWT 密钥、对象存储密钥或真实顾客数据提交到 Git。发布凭据使用 GitHub Secrets 或服务器安全配置；生产与测试环境应使用不同的密钥和数据。
