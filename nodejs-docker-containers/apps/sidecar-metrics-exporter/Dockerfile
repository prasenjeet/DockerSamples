FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Metrics endpoint for Prometheus scraping
EXPOSE 9090

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:9090/health || exit 1

CMD ["node", "src/metrics-exporter.js"]
