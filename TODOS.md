# TODOS

## Backend

### Add HTTP and module integration test coverage

**What:** Add meaningful Medusa HTTP integration and module integration tests, then run both declared suites successfully.

**Why:** The current unit suite passes, but the declared HTTP and module integration commands report zero matching test files, leaving API and module behavior without automated coverage.

**Context:** On 2026-10-13, `npm run test:integration:http --workspace=@dtc/backend` reported `**/integration-tests/http/*.spec.[jt]s - 0 matches`; `npm run test:integration:modules --workspace=@dtc/backend` reported `**/src/modules/*/__tests__/**/*.[jt]s - 0 matches`. Start with `apps/backend/jest.config.js`, `apps/backend/package.json`, and existing custom API routes under `apps/backend/src/api/`. Keep the currently passing `resolveProductIds` unit tests.

**Effort:** M
**Priority:** P0

## Completed
