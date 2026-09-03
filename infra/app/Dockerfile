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

# Chromium di sistema, non quello che Remotion si scarica: questa immagine è musl e il binario di
# Remotion è compilato per glibc — su Alpine non parte, e il sintomo è un render che fallisce senza
# mai nominare la libc. Il compositor nativo un musl ce l'ha, quindi manca solo il browser.
#
# I font non sono un extra: un Alpine nudo non ne ha nessuno, e il testo esce a quadratini in un
# PNG che per il resto sembra riuscito. Noto copre il latino, l'emoji serve alle grafiche che ne
# usano una.
RUN apk add --no-cache chromium font-noto font-noto-emoji ttf-dejavu
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/build ./build
COPY --from=builder /app/build-worker /app/build-worker
USER node
EXPOSE 3000
CMD ["node", "build"]
