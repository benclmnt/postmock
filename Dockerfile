# syntax=docker/dockerfile:1
# postmock on distroless Node 24, as a non-root user, from the built JavaScript only.
#   docker build -t postmock .
# Target `ca` runs tools/compose-ca.sh for compose.yaml.

FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY examples/node/package.json examples/node/
RUN pnpm install --frozen-lockfile --filter @benclmnt/postmock
COPY tsconfig.json tsconfig.build.json ./
COPY src src
COPY seeds seeds
RUN pnpm build

FROM build AS runtime-deps
RUN rm -rf node_modules && pnpm install --frozen-lockfile --prod --filter @benclmnt/postmock

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS ca
# hadolint ignore=DL3018
RUN apk add --no-cache bash openssl
COPY tools/test-ca.sh tools/compose-ca.sh /usr/local/bin/
# Empty named volumes mounted at /ca and /tls take this owner, so the non-root user writes them and
# postmock (the same user) reads the key.
RUN mkdir /ca /tls && chown 65532:65532 /ca /tls
USER 65532:65532
ENTRYPOINT ["compose-ca.sh"]

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=runtime-deps /src/node_modules node_modules
COPY --from=build /src/dist dist
ENV POSTMOCK_HOST=0.0.0.0 \
    POSTMOCK_SMTP_PORTS=2525
EXPOSE 8080 8025 2525
# Arguments after the image name are postmock flags.
ENTRYPOINT ["/nodejs/bin/node", "dist/src/main.js"]
