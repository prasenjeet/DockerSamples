const express = require('express');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const notesRouter = require('./routes/notes');

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_DIR = process.env.LOG_DIR || '/var/log/app';
const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/app-config';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Write logs to shared volume so the log-shipper sidecar can tail them
const logStream = fs.createWriteStream(path.join(LOG_DIR, 'app.log'), { flags: 'a' });
app.use(morgan('combined', { stream: logStream }));
app.use(morgan('dev'));

app.use(express.json());

// Load config written by the init-config-generator container
let appConfig = { appName: 'Notes App', version: '1.0.0', environment: 'development' };
const configFile = path.join(CONFIG_DIR, 'app-config.json');
if (fs.existsSync(configFile)) {
  try {
    appConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    console.log('Loaded config from init container:', appConfig);
  } catch (err) {
    console.warn('Could not parse config file, using defaults:', err.message);
  }
}

// In-memory metrics counters (scraped by metrics-exporter sidecar)
global.metrics = {
  requestsTotal: 0,
  requestErrors: 0,
  notesCreated: 0,
  notesRead: 0,
  startTime: Date.now(),
};

app.use((req, res, next) => {
  global.metrics.requestsTotal++;
  res.on('finish', () => {
    if (res.statusCode >= 400) global.metrics.requestErrors++;
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.floor((Date.now() - global.metrics.startTime) / 1000),
    config: appConfig,
  });
});

// Prometheus-style metrics endpoint — scraped by the metrics-exporter sidecar
app.get('/metrics', (req, res) => {
  const uptime = Math.floor((Date.now() - global.metrics.startTime) / 1000);
  res.set('Content-Type', 'text/plain');
  res.send(
    `# HELP app_requests_total Total number of HTTP requests\n` +
    `# TYPE app_requests_total counter\n` +
    `app_requests_total ${global.metrics.requestsTotal}\n\n` +
    `# HELP app_request_errors_total Total number of HTTP errors\n` +
    `# TYPE app_request_errors_total counter\n` +
    `app_request_errors_total ${global.metrics.requestErrors}\n\n` +
    `# HELP app_notes_created_total Total notes created\n` +
    `# TYPE app_notes_created_total counter\n` +
    `app_notes_created_total ${global.metrics.notesCreated}\n\n` +
    `# HELP app_uptime_seconds Application uptime in seconds\n` +
    `# TYPE app_uptime_seconds gauge\n` +
    `app_uptime_seconds ${uptime}\n`
  );
});

app.use('/api/notes', notesRouter);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[main-app] Server started on port ${PORT}`);
  console.log(`[main-app] Log file: ${path.join(LOG_DIR, 'app.log')}`);
  console.log(`[main-app] Config: ${JSON.stringify(appConfig)}`);
});
