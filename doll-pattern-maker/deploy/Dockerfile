# 1段目: Node でテストとビルド → 2段目: nginx で dist/ を配るだけ（Node は本番に残らない）
# ビルドコンテキストは doll-pattern-maker/（src/samples.ts が ../samples を読み込むため）

FROM node:22-alpine AS build
WORKDIR /src
# VPS のメモリが少ないので、ビルド中の Node のヒープを抑える
ENV NODE_OPTIONS=--max-old-space-size=384
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --no-audit --no-fund
COPY samples samples
COPY app app
RUN cd app && npm test && npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/app/dist /usr/share/nginx/html
