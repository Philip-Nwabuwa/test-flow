FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /workspace

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb x11vnc novnc \
  && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.base.json ./
COPY apps/recorder/package.json apps/recorder/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install -g bun@1.3.10 && bun install

COPY . .

RUN bun run --filter @automation/shared build && bun run --filter @automation/recorder build

CMD ["bun", "apps/recorder/dist/index.js"]
