FROM node:24.9.0-bookworm-slim

WORKDIR /src

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --chown=node index.mjs service.json README.md ./
COPY --chown=node help ./help
COPY --chown=node lib ./lib

RUN mkdir -p /src/uploads /src/data \
  && chown -R node:node /src/uploads /src/data

# For disk storage mode, mount the MessyDesk data root and set MD_PATH at runtime.
USER node
CMD ["node", "index.mjs"]
