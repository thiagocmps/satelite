# Build a partir da raiz do repositorio (precisa de ../db/migrations):
#   docker build -f backend/Dockerfile .

# ---- deps (producao) -------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --omit=dev

# ---- build ----------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/tsconfig.json ./
RUN npm install
COPY backend/src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=deps  /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist         ./dist
COPY --from=build /app/backend/package.json ./package.json
# migrations SQL em /app/db: o runner resolve ../../../db/migrations a partir de
# /app/backend/dist/db/migrate.js
COPY db /app/db
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
