FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Shared volume where this container writes configs for the main app
VOLUME ["/etc/app-config"]

CMD ["node", "src/generate-config.js"]
