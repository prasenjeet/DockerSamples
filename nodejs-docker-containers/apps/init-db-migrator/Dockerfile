FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Init containers run once and exit — no EXPOSE, no HEALTHCHECK
CMD ["node", "src/migrate.js"]
