/**
 * Sidecar Container: Metrics Exporter
 *
 * Pattern: Ambassador / Adapter sidecar.
 * The main app exposes a simple /metrics endpoint.
 * This sidecar:
 *   1. Polls the main app's /metrics endpoint via localhost (shared network)
 *   2. Enriches metrics with pod/host labels
 *   3. Exposes a Prometheus-compatible /metrics endpoint on port 9090
 *   4. Exposes a /dashboard endpoint with a human-readable HTML view
 *
 * This adapter pattern means the main app doesn't need to know about
 * Prometheus label conventions or monitoring infrastructure details.
 *
 * In Kubernetes: Prometheus scrapes port 9090 on the pod via annotation:
 *   prometheus.io/scrape: "true"
 *   prometheus.io/port: "9090"
 */

const express = require('express');
const http = require('http');

const MAIN_APP_HOST = process.env.MAIN_APP_HOST || 'localhost';
const MAIN_APP_PORT = parseInt(process.env.MAIN_APP_PORT || '3000');
const EXPORTER_PORT = parseInt(process.env.EXPORTER_PORT || '9090');
const SCRAPE_INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS || '5000');
const POD_NAME = process.env.POD_NAME || process.env.HOSTNAME || 'unknown-pod';
const NAMESPACE = process.env.NAMESPACE || 'default';
const SERVICE_NAME = process.env.SERVICE_NAME || 'main-app';

let cachedMetrics = '';
let lastScrapeTime = null;
let scrapeErrors = 0;

function fetchMetrics() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MAIN_APP_HOST,
      port: MAIN_APP_PORT,
      path: '/metrics',
      method: 'GET',
      timeout: 3000,
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

// Add Kubernetes-style labels to every metric line
function addLabels(rawMetrics) {
  const labels = `pod="${POD_NAME}",namespace="${NAMESPACE}",service="${SERVICE_NAME}"`;
  const lines = rawMetrics.split('\n');
  const result = [];

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      result.push(line);
      continue;
    }
    // metric_name value  →  metric_name{labels} value
    const spaceIdx = line.lastIndexOf(' ');
    if (spaceIdx === -1) {
      result.push(line);
      continue;
    }
    const metricPart = line.substring(0, spaceIdx);
    const valuePart = line.substring(spaceIdx);

    if (metricPart.includes('{')) {
      // Already has labels: metric{existing} value → metric{existing,new} value
      result.push(metricPart.replace('}', `,${labels}}`) + valuePart);
    } else {
      result.push(`${metricPart}{${labels}}${valuePart}`);
    }
  }

  // Add sidecar self-metrics
  result.push('');
  result.push('# HELP sidecar_scrape_errors_total Total scrape errors from main app');
  result.push('# TYPE sidecar_scrape_errors_total counter');
  result.push(`sidecar_scrape_errors_total{${labels}} ${scrapeErrors}`);
  result.push('');
  result.push('# HELP sidecar_last_scrape_timestamp Unix timestamp of last successful scrape');
  result.push('# TYPE sidecar_last_scrape_timestamp gauge');
  result.push(`sidecar_last_scrape_timestamp{${labels}} ${lastScrapeTime ? lastScrapeTime / 1000 : 0}`);

  return result.join('\n');
}

async function scrapeLoop() {
  console.log(`[metrics-exporter] Starting scrape loop (interval: ${SCRAPE_INTERVAL_MS}ms)`);
  while (true) {
    try {
      const raw = await fetchMetrics();
      cachedMetrics = addLabels(raw);
      lastScrapeTime = Date.now();
    } catch (err) {
      scrapeErrors++;
      console.error(`[metrics-exporter] Scrape error (#${scrapeErrors}): ${err.message}`);
    }
    await sleep(SCRAPE_INTERVAL_MS);
  }
}

function buildDashboard() {
  const uptime = lastScrapeTime ? Math.floor((Date.now() - lastScrapeTime) / 1000) : 'N/A';
  const lines = cachedMetrics.split('\n').filter(l => !l.startsWith('#') && l.trim());
  const rows = lines.map(l => {
    const parts = l.split(' ');
    const value = parts[parts.length - 1];
    const name = parts.slice(0, -1).join(' ');
    return `<tr><td>${name}</td><td><strong>${value}</strong></td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Metrics Dashboard — ${SERVICE_NAME}</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #0f3460; background: #e94560; padding: 10px; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #0f3460; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #333; }
    tr:hover { background: #16213e; }
    .meta { color: #aaa; font-size: 0.85em; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h1>Metrics — ${SERVICE_NAME}</h1>
  <p class="meta">Pod: ${POD_NAME} | Namespace: ${NAMESPACE} | Last scrape: ${uptime}s ago | Errors: ${scrapeErrors}</p>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[metrics-exporter] Sidecar starting`);
  console.log(`[metrics-exporter] Scraping: http://${MAIN_APP_HOST}:${MAIN_APP_PORT}/metrics`);
  console.log(`[metrics-exporter] Exporting on: http://0.0.0.0:${EXPORTER_PORT}/metrics`);

  scrapeLoop(); // runs in background

  const app = express();

  app.get('/metrics', (req, res) => {
    if (!cachedMetrics) {
      return res.status(503).send('# Waiting for first scrape...\n');
    }
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(cachedMetrics);
  });

  app.get('/dashboard', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.send(buildDashboard());
  });

  app.get('/health', (req, res) => {
    const healthy = lastScrapeTime && (Date.now() - lastScrapeTime) < SCRAPE_INTERVAL_MS * 3;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      lastScrape: lastScrapeTime,
      scrapeErrors,
    });
  });

  app.listen(EXPORTER_PORT, () => {
    console.log(`[metrics-exporter] Listening on port ${EXPORTER_PORT}`);
  });
}

main();
