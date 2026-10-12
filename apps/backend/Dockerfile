FROM node:22.23.3-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci

COPY apps/backend apps/backend
RUN npm run build --workspace=@dtc/backend

FROM node:22.23.3-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=9000
WORKDIR /app

COPY --from=build /app/apps/backend/.medusa/server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/apps/backend/.medusa/server ./

USER node
EXPOSE 9000

CMD ["npm", "run", "start"]
