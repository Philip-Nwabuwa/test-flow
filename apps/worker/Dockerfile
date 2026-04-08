FROM oven/bun:1.2.5-alpine

WORKDIR /workspace

RUN apk add --no-cache docker-cli libc6-compat

COPY package.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install

COPY . .

RUN bun run --filter @automation/shared build && bun run --filter @automation/worker build

CMD ["bun", "apps/worker/dist/index.js"]
