# Project guidance

## Runtime and verification

Use Node.js 24.21.0 and npm 11.19.0, pinned in `.nvmrc` and the workspace manifests. Install with `npm ci` from the repository root. Run backend lint/unit tests, Storefront lint/typecheck, then `npm run build` before relying on a change. CI runs the same quality checks and uses placeholder Storefront values only for compilation.

## Architecture

- `apps/backend` is Medusa v2 and is deployed as a Docker image to a cloud VPS.
- `apps/storefront` is Next.js and is built/deployed by Vercel. Vercel still runs the Next.js production build; it does not need a Storefront Docker image.
- GitHub Actions publishes only the Backend image to GHCR after checks pass on `main`. VPS deployment is manually initiated by the owner using a commit-SHA image; Actions does not SSH to the VPS.
- `infra/local` is local development. `infra/vps` is a separate new-environment Compose template. New VPS databases start empty; do not import local data or delete local volumes as part of deployment work.

## Configuration constraints

Vercel public variables may contain only public URLs, region values, and Medusa Publishable API Keys. A Publishable API Key is created in Medusa Admin and associated with the Storefront Sales Channel; it is not an Admin credential. Production Storefront must use a reachable HTTPS backend URL and matching key. Preview should use an isolated staging backend or be intentionally restricted. Set Medusa CORS to exact intended origins.

VPS secrets belong only in a protected server-side environment. Keep PostgreSQL, Redis, and the Worker off public ports. Validate Medusa server/worker mode and the one-time migration/bootstrap procedure against the installed version before using production configuration. Preserve volumes during application updates and test backups/restores before production use.

## Documentation

`README.md` is the project entrypoint; `docs/deployment.md` describes the current target topology and its unverified prerequisites. Treat previous architecture documents as historical until their statements are independently verified against current code and infrastructure. Do not describe a provider, deployment, payment flow, or backup as verified without a real test.
