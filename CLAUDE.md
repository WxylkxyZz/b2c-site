# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project status

This repository is currently in the planning/documentation phase on Windows `main`. It contains the proposed architecture and learning guide; it does not yet contain the Medusa or Next.js application implementation. The WSL checkout is a separate branch/copy and must not be assumed to match this repository.

Do not describe proposed infrastructure as deployed or verified. Before scaffolding or implementing, read `README.md`, `docs/architecture.md`, and `docs/medusa-learning-guide.md`. Verify commands, versions, configuration, provider behavior, and resource requirements against the actual generated project and matching official Medusa documentation.

## Current direction

- Commerce backend: Medusa v2.
- Customer storefront: Next.js, deployed separately from Medusa.
- Self-hosting: user-selected VPS managed with Docker Compose.
- Initial preference: PostgreSQL and Redis on the VPS; account for the operational responsibility and single-host failure domain.
- Production images: build in CI, publish versioned project images to GHCR, and have the VPS pull them. Do not build production images on a small VPS unless resource capacity is explicitly validated.
- Medusa production topology: plan for separate server and worker instances; verify the exact version-specific configuration and command before implementation.
- Product media: target S3-compatible object storage; Cloudflare R2 is the current preference, not yet configured or validated.

These are planning decisions, not a claim that any application, service, credentials, or deployment currently exists.

## Safety and implementation constraints

- Never commit `.env` files, payment credentials, database passwords, JWT secrets, object-storage secrets, customer data, or production database artifacts.
- Keep staging and production databases, Redis instances, domains, and credentials isolated.
- Preserve existing user data and untracked files. Inspect before deleting or overwriting; ask before irreversible changes outside an explicitly authorized scope.
- Run database migrations as part of a tested release process. Back up first and test migrations/restores in staging; do not assume reverting an application image reverses a database migration.
- Do not accept live payments until payment provider configuration, webhook signature verification, idempotency, retry behavior, and failure paths have been tested.
- Do not make legal, tax, or provider eligibility assumptions based solely on architecture notes; verify with authoritative sources and the relevant provider.

## Documentation

- `README.md` is the project entrypoint and links to the detailed docs.
- `docs/architecture.md` describes the proposed deployment architecture, open decisions, and rollout considerations.
- `docs/medusa-learning-guide.md` introduces Medusa concepts for the project owner.

Keep documentation explicit about what is confirmed, what is a recommendation, and what remains unverified. Match the user's beginner-friendly preference when explaining Medusa-specific concepts.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke `/office-hours`
- Strategy/scope → invoke `/plan-ceo-review`
- Architecture → invoke `/plan-eng-review`
- Design system/plan review → invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline → invoke `/autoplan`
- Bugs/errors → invoke `/investigate`
- QA/testing site behavior → invoke `/qa` or `/qa-only`
- Code review/diff check → invoke `/review`
- Visual polish → invoke `/design-review`
- Ship/deploy/PR → invoke `/ship` or `/land-and-deploy`
- Save progress → invoke `/context-save`
- Resume context → invoke `/context-restore`
- Author a backlog-ready spec/issue → invoke `/spec`
