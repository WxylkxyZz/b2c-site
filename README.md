# B2Csite

Medusa v2 commerce backend and Next.js customer storefront. This repository follows the official Medusa workspace scaffold, with deployment-specific configuration for Vercel and a VPS.

## Architecture

- **Storefront:** `apps/storefront` is the customer-facing Next.js app. Vercel builds and deploys it from Git; it is not published as a Docker image.
- **Commerce backend:** `apps/backend` is Medusa, including the Admin and Store APIs. GitHub Actions runs checks and publishes only the Backend Docker image to GHCR after a successful push to `main`.
- **VPS release:** The owner selects an immutable Backend image tag/digest and updates Medusa on the VPS with Docker Compose. GitHub Actions does not SSH to or deploy the VPS.
- **Data:** Local development uses `infra/local/compose.yaml`. New VPS environments use separate empty PostgreSQL/Redis data and must not import local test data. Existing local database volumes are retained.

See [deployment and operations](docs/deployment.md) for Vercel, GHCR, VPS, migration, backup, and release setup. The guide marks provider settings and environment-level work that have not been verified.

## Runtime and install

Use Node.js `24.21.0` and npm `11.19.0` as pinned in `.nvmrc` and the root package metadata. Run from the repository root:

```sh
npm ci
```

Configure local Storefront values in an ignored env file based on `apps/storefront/.env.example`. Configure the backend using `apps/backend/.env.template`. Never use real secrets in `NEXT_PUBLIC_*` values; the Medusa Publishable API Key is public, but Admin, database, JWT/Cookie, payment, and object-storage secrets are not.

## Development

Start local PostgreSQL and Redis first, either through the local Compose stack or another local service setup. The root Compose project preserves its named database volume; do not use `docker compose down -v` for routine stops.

```sh
npm run backend:dev
npm run storefront:dev
```

For local containers, copy `infra/local/.env.example` to the ignored `infra/local/.env.local`, fill in local-only values, and run:

```sh
docker compose --env-file infra/local/.env.local -f infra/local/compose.yaml up --build
```

## Checks

```sh
npm run lint --workspace=@dtc/backend
npm run lint --workspace=@dtc/storefront
npm run typecheck --workspace=@dtc/storefront
npm run test:unit --workspace=@dtc/backend
npm run build
```

Run a single Backend unit test with Jest path or test-name filters:

```sh
npm run test:unit --workspace=@dtc/backend -- --runTestsByPath src/search/helpers/__tests__/resolve-product-ids.unit.spec.ts
npm run test:unit --workspace=@dtc/backend -- -t "matches product IDs"
```

The Backend HTTP/module integration-test commands exist, but currently have no matching test files; see `TODOS.md`. The storefront has no separate test suite. CI uses fake public Storefront values to compile and test code; these values do not connect to Medusa.

## Current security note

`npm audit` currently reports unresolved vulnerabilities in the Medusa 2.21.2 dependency tree and related tooling. Do not run `npm audit fix --force`: the reported Medusa fix suggestion downgrades the framework, and the Tailwind major upgrade conflicts with the current Medusa UI preset. Review `docs/deployment.md` for the latest verified audit status and upgrade constraints; do not treat the project as vulnerability-free until a new audit confirms that.
