FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build:node
RUN npm run worker:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/build ./build
COPY --from=builder /app/build-worker /app/build-worker
USER node
EXPOSE 3000
CMD ["node", "build"]
