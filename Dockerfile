# HERMES Helfer: one image for the API, the web app and the migration job.
#
#   docker build -t hermes-helfer .
#   docker run -p 8080:8080 --env-file … hermes-helfer       API and web app
#   docker run --env-file … hermes-helfer dist/migrate.js      migration job
#
# Base images: Microsoft's Azure Linux images with Node.js 24 LTS from
# mcr.microsoft.com, pinned by digest (Dependabot proposes updates). The
# runtime image is distroless: no shell, no package manager, runs as nonroot.

ARG BUILD_IMAGE=mcr.microsoft.com/azurelinux/base/nodejs:24.21.0-1-azl3.0.20261005@sha256:c30e39a396fb0ad2c7bf2fe6b4e2fe1598a9b79f09831c07d763fe09927e8779
ARG RUNTIME_IMAGE=mcr.microsoft.com/azurelinux/distroless/nodejs:24.21.0-1-nonroot-azl3.0.20261005@sha256:be12f1235ae675a4246ac2a276ac20aac8b573e70914f726c17b96615a573ced

FROM ${BUILD_IMAGE} AS build
WORKDIR /src
# Dependencies first, so this layer is cached until a package file changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build \
  # Source maps of the web app stay out of the image; the API keeps its own for stack traces.
  && find apps/web/dist -name "*.map" -delete \
  # Production dependencies of the API only (the bundle contains @hermes-helfer/core).
  && rm -rf node_modules \
  && npm ci --omit=dev --workspace @hermes-helfer/api --no-audit --no-fund

FROM ${RUNTIME_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST_DIR=/app/web
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/web/dist ./web
USER nonroot
EXPOSE 8080
ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/main.js"]
