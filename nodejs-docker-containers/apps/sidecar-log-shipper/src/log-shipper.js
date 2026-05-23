/**
 * Sidecar Container: Log Shipper
 *
 * Pattern: The sidecar runs alongside the main container, sharing a volume.
 * The main app writes logs to /var/log/app/app.log.
 * This sidecar tails that file, parses each line, enriches it with metadata,
 * and "ships" it (here: prints structured JSON to stdout, simulating a
 * log aggregation backend like Elasticsearch, Loki, or Datadog).
 *
 * Key sidecar characteristics:
 *  - Same lifecycle as the main container (starts/stops together)
 *  - Shares network namespace (can call localhost)
 *  - Shares volumes (reads main app's log files)
 *  - Does NOT require changes to the main application image
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_DIR = process.env.LOG_DIR || '/var/log/app';
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '500');
const HOSTNAME = process.env.HOSTNAME || 'unknown-host';
const SERVICE_NAME = process.env.SERVICE_NAME || 'main-app';

// Simulated log destination (in production: send to Elasticsearch, Loki, etc.)
function shipLog(structured) {
  process.stdout.write(JSON.stringify(structured) + '\n');
}

// Parse Apache Combined Log Format into fields
function parseApacheCombinedLog(line) {
  const regex = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) (\d+|-)/;
  const match = line.match(regex);
  if (!match) return null;
  return {
    remoteAddr: match[1],
    user: match[2],
    timestamp: match[3],
    method: match[4],
    path: match[5],
    status: parseInt(match[6]),
    bytes: match[7] === '-' ? 0 : parseInt(match[7]),
  };
}

function enrichLog(rawLine) {
  const parsed = parseApacheCombinedLog(rawLine);
  const base = {
    '@timestamp': new Date().toISOString(),
    service: SERVICE_NAME,
    host: HOSTNAME,
    shipper: 'sidecar-log-shipper',
    raw: rawLine,
  };

  if (parsed) {
    return {
      ...base,
      http: {
        method: parsed.method,
        path: parsed.path,
        status: parsed.status,
        bytes: parsed.bytes,
      },
      level: parsed.status >= 500 ? 'ERROR' : parsed.status >= 400 ? 'WARN' : 'INFO',
    };
  }

  // Non-HTTP log line (console.log output from app)
  const level = rawLine.includes('error') || rawLine.includes('Error') ? 'ERROR'
    : rawLine.includes('warn') || rawLine.includes('Warn') ? 'WARN'
    : 'INFO';

  return { ...base, level, message: rawLine };
}

async function waitForLogFile() {
  console.error(`[log-shipper] Waiting for log file: ${LOG_FILE}`);
  while (!fs.existsSync(LOG_FILE)) {
    await sleep(POLL_INTERVAL_MS);
  }
  console.error(`[log-shipper] Log file found, starting tail`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tailFile() {
  await waitForLogFile();

  let fileSize = fs.statSync(LOG_FILE).size;
  console.error(`[log-shipper] Tailing ${LOG_FILE} from offset ${fileSize}`);

  // Ship existing lines first
  await processFileRange(0, fileSize);

  // Then watch for new content
  fs.watch(LOG_FILE, async () => {
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > fileSize) {
        await processFileRange(fileSize, stat.size);
        fileSize = stat.size;
      } else if (stat.size < fileSize) {
        // Log rotation
        console.error('[log-shipper] Log rotation detected, resetting offset');
        fileSize = 0;
      }
    } catch (err) {
      console.error('[log-shipper] Watch error:', err.message);
    }
  });
}

async function processFileRange(start, end) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(LOG_FILE, { start, end: end - 1 });
    const rl = readline.createInterface({ input: stream });
    rl.on('line', line => {
      if (line.trim()) {
        shipLog(enrichLog(line));
      }
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

async function main() {
  console.error(`[log-shipper] Sidecar starting — shipping logs from ${LOG_FILE}`);
  console.error(`[log-shipper] Service: ${SERVICE_NAME}, Host: ${HOSTNAME}`);

  try {
    await tailFile();
    // Keep alive — fs.watch is event-driven
    await new Promise(() => {});
  } catch (err) {
    console.error('[log-shipper] Fatal error:', err.message);
    process.exit(1);
  }
}

main();
