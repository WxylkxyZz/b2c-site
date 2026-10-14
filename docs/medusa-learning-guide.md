# Medusa 入门指南

本文面向刚接触 Medusa、但了解网站与服务器基本概念的项目所有者。目标是解释关键概念，帮助区分“在 Admin 改数据”和“修改代码重新发布”。具体命令、环境变量和版本行为以仓库当前代码及对应版本的 Medusa 官方文档为准。

## Medusa 在本项目中的角色

Medusa 是电商业务后端，提供商品、价格、区域、购物车、顾客、订单等业务能力和 Store/Admin API。Medusa Admin 是商家管理界面；Next.js Storefront 是顾客浏览和下单的网站。

```text
顾客浏览器
  └─ Next.js Storefront（Vercel）
       └─ HTTPS + Store API Publishable Key
            └─ Medusa Server（云 VPS）
                 ├─ PostgreSQL：长期业务数据
                 ├─ Redis：队列及运行状态
                 └─ Medusa Worker：后台任务

商家 ── HTTPS ──> Medusa Admin（由 Medusa 应用提供）
```

Storefront 与 Medusa 分开部署，但必须通过公开 HTTPS API 地址、正确的 Publishable API Key、Sales Channel 和 CORS 配置协作。Publishable API Key 是浏览器可见的公开标识，不是 Admin 密钥；Admin 凭据、数据库/JWT/Cookie/支付 secret 只能保存在后端安全环境。

## 修改数据还是修改代码

| 需求 | 通常修改内容 | 通常是否部署代码 |
|---|---|---|
| Admin 里创建商品、调整价格/库存、处理订单 | Medusa 数据 | 否 |
| 修改首页布局、商品页或顾客交互 | Next.js Storefront | Vercel 构建/部署 Storefront |
| 增加后端 API、业务规则或 provider | Medusa 代码/配置 | GitHub Actions 构建 Backend 镜像，之后由用户在 VPS 部署 |
| 升级 Medusa 或更改数据库结构 | Backend 依赖/代码和数据库 schema | 需要构建镜像，并按版本执行受控迁移 |

改数据库 schema 的 migration 与应用镜像更新是两个不同操作。旧镜像回滚不一定能撤销已执行的 migration；升级前备份，并先在 staging 验证。

## Store API、Admin API 与销售渠道

- **Store API**：供 Storefront 执行顾客流程，通常要求带 Publishable API Key。
- **Admin API**：供管理界面和授权管理操作使用，不可把 Admin 密钥发送给浏览器。
- **Region**：定义市场、货币、国家等销售范围。
- **Sales Channel**：控制哪些商品可通过某渠道对外销售。Storefront 使用的 Publishable API Key 需关联正确的 Sales Channel，商品也需与该渠道匹配；仅验证 regions 接口成功，并不能证明商品一定可见。

调试商品不可见时，依次检查 key 的渠道关联、商品发布状态/渠道关联、region 和价格，而不要一开始就重置数据库或重复运行初始化 seed。

## Medusa Server、Worker、PostgreSQL、Redis

- **Server** 处理 HTTP API 和 Admin 请求。
- **Worker** 处理后台队列、事件订阅和任务。生产中通常与 Server 分开运行，不应直接公开公网端口；具体 mode/命令必须按锁定的 Medusa 版本核验。
- **PostgreSQL** 保存主要长期业务数据。VPS Compose volume 应持久化，并配置 VPS 外备份及实际恢复演练。
- **Redis** 支持队列及相关运行能力，不是 PostgreSQL 替代品；验证队列负载、持久化、内存与 eviction 策略后再部署。
- **S3 兼容对象存储**可存放商品图片等媒体。数据库备份通常只有 metadata/reference，不包含图片 bytes；媒体备份需单独考虑。

将数据库与 Redis 放在同一 VPS 简化初期配置，但形成单机故障域；要监控磁盘、内存、服务健康和 worker backlog，并保留异机备份和恢复计划。

## 数据库迁移与空环境

创建新的 VPS staging/production 环境时应使用隔离的空数据库、Redis、密钥和对象存储设置，不自动导入本地测试数据。首次迁移 schema 不会自动创建全部电商业务基础数据、Publishable API Key 或管理员用户；migration、Store/Region/Sales Channel 初始化和 Admin 创建需分开核验。

初始 seed 可能不是幂等脚本。执行前先阅读脚本并检查当前环境数据，确认重复执行、失败重试和部分写入行为。不要通过直接 SQL 删除 Store、Sales Channel 或生产订单来“清理”状态。

## Vercel、GitHub Actions、GHCR 与 VPS 发布

本项目的目标发布边界：

1. Vercel 从 Git 仓库构建并部署 Next.js Storefront；Vercel build 不是 Docker 镜像构建。
2. GitHub Actions 在 PR/main 执行检查；main 检查成功后只构建 Medusa Backend Docker 镜像并推送 GHCR，使用 commit SHA/digest 标识。
3. 用户审核镜像 tag/digest 后，在 VPS 手动 pull 并用 Docker Compose 更新。Actions 不通过 SSH 自动部署 VPS。
4. 发布 Backend 镜像不等于 migration、空库初始化或线上功能验证已完成；这些操作需分别计划、备份并验收。

目标架构的配置细节、Vercel 环境变量、CORS、VPS 首次启动和运维命令见 [`docs/deployment.md`](deployment.md)。该文档会明确标出尚未实际验证的服务和步骤。

## 建议学习路径

1. 先在测试环境浏览 Medusa Admin，认识商品、variant、price、库存、region、Sales Channel 与订单。
2. 建一个测试商品，确认 Store API 可见并理解 Publishable API Key 和 Sales Channel 的关系。
3. 从 Storefront 观察浏览商品、切换 region、购物车、地址和配送流程；仅使用测试数据。
4. 需要新功能时，判断变化属于 Storefront UI、Medusa 后端、provider 配置还是 Admin 数据。
5. 生产前验证 staging 的 migration、备份恢复、worker、CORS、媒体、支付 webhook 及回滚流程。测试未通过前不要启用 live payment。

## 官方参考

- [Medusa 文档](https://docs.medusajs.com/)
- [Medusa 安装与运行要求](https://docs.medusajs.com/learn/installation)
- [Medusa 架构与模块](https://docs.medusajs.com/learn/introduction/architecture)
- [Storefront Publishable API Key](https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys)
- [Medusa 部署概览](https://docs.medusajs.com/learn/deployment)

文档概念不替代支付、税务、法律或供应商资格意见；provider 与生产配置需以当前官方文档和实际服务为准。
