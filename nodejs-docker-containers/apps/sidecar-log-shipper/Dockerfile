FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Shared volume — main app writes here, sidecar reads
VOLUME ["/var/log/app"]

CMD ["node", "src/log-shipper.js"]
