FROM oven/bun:1.3.12-debian

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
USER bun
ENV BUN_CHROME_PATH=/usr/bin/chromium \
    LANG=zh_CN.UTF-8 \
    LC_ALL=C.UTF-8

EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
