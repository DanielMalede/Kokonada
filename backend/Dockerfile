FROM node:20-slim

# Pin the runtime environment so fail-closed guards (e.g. the Garmin webhook) and
# prod-only behavior never hinge on the platform remembering to set it. (audit F1)
ENV NODE_ENV=production

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
