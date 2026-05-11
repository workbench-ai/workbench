FROM node:22-bookworm-slim AS node

FROM python:3.12-bookworm

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu libreoffice \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir openpyxl pandas
