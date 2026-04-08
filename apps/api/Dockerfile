FROM oven/bun:1.2.5-alpine

WORKDIR /workspace

RUN apk add --no-cache libc6-compat

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install

COPY . .

RUN bun run --filter @automation/shared build && bun run --filter @automation/api build

CMD ["bun", "apps/api/dist/index.js"]
