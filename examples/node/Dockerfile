# syntax=docker/dockerfile:1
# The example app image. Build context: the repo root (compose.yaml).
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY examples/node/package.json examples/node/
RUN pnpm install --frozen-lockfile --prod --filter postmock-example-node
COPY examples/node/default-hosts.ts examples/node/
USER node
WORKDIR /repo/examples/node
CMD ["node", "default-hosts.ts"]
