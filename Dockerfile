FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/content/package.json packages/content/package.json
RUN corepack pnpm install --no-frozen-lockfile

FROM deps AS build
COPY . .
RUN corepack pnpm generate:content
RUN corepack pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/server/public
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
