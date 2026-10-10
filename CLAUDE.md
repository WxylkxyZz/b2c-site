# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Pre-implementation. This repo currently contains only `docs/architecture.md` — a fully specified technical architecture for a B2C cross-border DTC e-commerce site. No code has been written yet. The plan is to scaffold the project with `npx create-medusa-app@latest b2c-site`, which will generate a monorepo (`apps/backend` + `apps/storefront`).

## Architecture Decisions (locked)

Read `docs/architecture.md` for the full spec. Key locked decisions:

- **Framework**: Medusa v2.21+ (MIT, self-hosted, no GMV fees). Not Shopify.
- **Storefront**: Official Next.js Starter (App Router), installed as monorepo via `create-medusa-app`.
- **Entity**: US company, US Stripe account.
- **Payments**: Stripe (primary, Payment Element for SAQ-A PCI scope) + PayPal (secondary).
- **Settlement**: USD → WorldFirst/PingPong → CNY. ⚠️ Unverified assumption: WorldFirst's US ACH account may not be accepted as Stripe payout target (Stripe may require account name = merchant name). Test before committing.
- **Hosting**: VPS single-machine Docker Compose (Hetzner CAX21, US region, ARM 4C/8GB, €3.39/mo). NOT CX22 (that's x86 2C/4GB — wrong spec).
- **Object storage**: Cloudflare R2 (free 10GB + CDN), NOT local MinIO in production. MinIO only for local dev.
- **CDN**: Cloudflare free tier in front of Caddy.
- **Images**: CI builds → push GHCR → VPS pulls. Never build on VPS (4GB ARM will OOM during Medusa admin build).
- **Staging**: Same VPS, isolated compose project, different ports.
- **Reverse proxy**: Caddy 2 (auto TLS). Admin path protected with `basic_auth`, not IP allowlist (home IP is dynamic).
- **Redis**: Must set `maxmemory 256mb --maxmemory-policy allkeys-lru` to prevent queue backlog from eating PG memory.
- **DB migrations**: Run `medusa db:migrate` on every version upgrade. Missing this causes startup failure.

## Tech Stack

- **Runtime**: Node.js 22 LTS (local machine has v24 — must pin to 22 via nvm-windows or Docker dev env)
- **Backend**: Medusa v2 (Node 22, TypeScript, Express)
- **Storefront**: Next.js (App Router, standalone output)
- **DB**: PostgreSQL 15+
- **Cache/Queue**: Redis 7 (mandatory in production — workflow engine + event bus)
- **Object Storage**: Cloudflare R2 (S3-compatible)
- **Reverse Proxy**: Caddy 2
- **Email**: Resend (free tier 3K/month; ~1500 orders/mo with 2 emails each hits the cap)
- **CI/CD**: GitHub Actions → GHCR → VPS pull
- **Monitoring**: UptimeRobot (free) + Sentry (free 5K events/mo)

## Critical Path (must do before going live)

1. **Stripe/PayPal webhook idempotency + retry testing** — the one critical gap flagged in the eng review. A lost webhook means payment received but order not confirmed (silent failure). Build idempotency into webhook handlers before accepting live payments.
2. **Verify WorldFirst ACH as Stripe payout target** — test with a small payout before committing the full settlement path.

## Payment Flow (three-segment)

```
Checkout (Stripe/PayPal) → Stripe USD balance → ACH T+2 → US bank account → WorldFirst/PingPong → CNY
```

Do not confuse: WorldFirst/PingPong do settlement (USD→CNY), NOT checkout acquiring. Stripe does checkout acquiring.

## Project Structure (post-scaffold)

```
apps/
  backend/         # Medusa server (medusa-config.ts, src/api, src/modules, src/subscribers, src/workflows, src/jobs)
  storefront/      # Next.js storefront (app/[countryCode]/)
packages/          # Shared types/UI (optional)
.github/workflows/ # CI build → GHCR
docker-compose.yml          # Local dev: pg + redis + minio
docker-compose.prod.yml     # Production: pull from GHCR
docker-compose.staging.yml  # Same VPS, isolated, different ports
Caddyfile                   # Reverse proxy + TLS
.nvmrc                      # Pin Node 22 LTS
```

## Environment Variables

Backend (`apps/backend/.env` / `.env.prod`):
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `STRIPE_API_KEY` — Stripe secret key
- `JWT_SECRET` — Medusa admin JWT
- `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_ENDPOINT`, `R2_BUCKET` — Cloudflare R2

Storefront (`apps/storefront/.env.local` / `.env.prod`):
- `MEDUSA_BACKEND_URL` — backend URL
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` — required on every Store API request via `x-publishable-api-key` header
- `NEXT_PUBLIC_STRIPE_KEY` — Stripe publishable key

Never commit `.env.prod` to git.

## Useful Commands (post-scaffold)

```bash
# Local dev
npx create-medusa-app@latest b2c-site    # Initial scaffold (run once)
docker compose up -d                      # Start pg + redis + minio
cd apps/backend && npm run dev            # Medusa server :9000 + admin /app
cd apps/storefront && npm run dev         # Storefront :8000

# Production deploy (on VPS)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
npx medusa db:migrate                     # On schema changes

# Staging (same VPS)
docker compose -p b2cstaging pull
docker compose -p b2cstaging up -d
```

## Local Dev Setup (Windows)

Required tools (not yet installed on this machine):
- **Git for Windows** — `create-medusa-app` internally uses git clone
- **Docker Desktop** — provides pg/redis/minio containers via WSL2 backend
- **nvm-windows** — to pin Node 22 LTS (current v24 may cause edge issues; v25+ is known broken with Medusa)

WSL2 Ubuntu is NOT needed for local dev — Docker Desktop already uses WSL2 as its backend. Run directly in PowerShell/Windows. Only install WSL2 Ubuntu if hitting Windows-specific path/CRLF issues.

## Cost Target

~$5/month fixed infrastructure (Hetzner CAX21 + free tiers of R2/Cloudflare/GHCR/UptimeRobot/Sentry). No GMV-based platform fees. All other costs are variable (Stripe per-transaction, WorldFirst settlement percentage).
