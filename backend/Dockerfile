FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app/ ./app/

EXPOSE 5000

CMD ["node", "app/index.js"]
