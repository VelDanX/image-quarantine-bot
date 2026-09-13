FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

ENV NODE_ENV=production

CMD ["node", "src/main.js"]
