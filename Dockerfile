# 多階段建置：builder 產生 dist 與生產依賴，runtime 只保留執行所需內容。
FROM node:24-alpine AS builder

WORKDIR /app

# 先複製鎖檔以利用層快取；原始碼變更不會使依賴安裝失效。
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY src ./src
# 前端與後端同源部署，映像必須同時含 dist/web，否則容器只有 API 沒有介面。
COPY web ./web
RUN npm run build

# 移除開發依賴，只留執行期需要的套件供 runtime 階段複製。
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime

WORKDIR /app

# 以非 root 執行，降低容器逃逸後的影響範圍。
RUN addgroup -S app && adduser -S -G app app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

# migration 需要在容器內執行時使用，因此保留 drizzle 與 scripts。
COPY --chown=app:app drizzle ./drizzle
COPY --chown=app:app scripts ./scripts

USER app

EXPOSE 3000

# 健康檢查直接打既有的 /health；資料庫不可用時該端點回 503，容器會被標記為 unhealthy。
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
