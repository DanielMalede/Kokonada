FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app/ ./app/

# Drop root: run as the image's built-in unprivileged `node` user so a process
# compromise can't write outside the app or escalate on the host. (audit T2.5)
RUN chown -R node:node /app
USER node

EXPOSE 5000

CMD ["node", "app/index.js"]
