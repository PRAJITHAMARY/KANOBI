# Control-plane API for the local Docker environment (see ../docker-compose.yml).
FROM node:22-bookworm-slim

WORKDIR /app

# serverless@3 needs no Serverless account login (v4 does); it deploys generated
# services to LocalStack. typescript is used by the generated services' `npm run build`.
RUN npm install -g serverless@3 typescript

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/local/index.js"]
