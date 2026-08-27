FROM node:22-alpine
WORKDIR /app
COPY sidecar.mjs sidecar.test.mjs ./
USER node
CMD ["node", "sidecar.mjs"]
