# Sidecar Containers

## What is a Sidecar Container?

A sidecar container runs **alongside** the main application container inside the same pod. They share:

- **Network namespace** — sidecars reach the main app via `localhost`
- **Pod volumes** — sidecars read/write files shared with the main app
- **Pod lifecycle** — sidecars start and stop with the pod

The name comes from the motorcycle sidecar: it travels with the main vehicle, extends its capabilities, but has its own purpose.

## When to Use Sidecars

| Scenario | Sidecar Role |
|---|---|
| **Log aggregation** | Tail log files written by the main app and forward to a centralized backend |
| **Metrics export** | Scrape and re-expose metrics in a format Prometheus can understand |
| **Reverse proxy / mTLS** | Envoy or Istio proxy handles TLS termination and routing so the app doesn't have to |
| **Secret sync** | Fetch secrets from Vault and write them to a shared volume as files |
| **Config reload** | Watch for config changes and signal the main app to reload |
| **Health adapter** | Translate the main app's health format to what the orchestrator expects |

## Sidecar Patterns

### 1. Ambassador Pattern
The sidecar acts as an outbound proxy — the main app talks to `localhost`, and the sidecar forwards traffic to the real destination. Useful for retries, circuit breaking, or protocol translation.

### 2. Adapter Pattern
The sidecar translates the main app's interface to match what external consumers expect. The `sidecar-metrics-exporter` in this project is an adapter: the main app exposes a simple `/metrics` endpoint, and the adapter enriches and re-exposes it with Prometheus labels.

### 3. Log Aggregation Pattern
The sidecar tails log files, parses them, and ships them to a backend. The main app doesn't know or care where logs go — it just writes to a file.

## This Project's Sidecar Containers

### `sidecar-log-shipper`

**Source:** `apps/sidecar-log-shipper/src/log-shipper.js`

**Pattern:** Log Aggregation

**How it works:**
1. Waits for the main app's log file (`/var/log/app/app.log`) to appear
2. Reads all existing lines
3. Uses `fs.watch` to detect new content as it's appended
4. Parses each line as Apache Combined Log Format (HTTP requests) or plain text
5. Enriches each entry with `@timestamp`, `service`, `host`, HTTP fields, and severity level
6. Writes structured JSON to stdout (in production: send to Elasticsearch, Loki, Datadog, etc.)

**Example output (one log line → structured JSON):**
```json
{
  "@timestamp": "2026-06-15T00:01:00.000Z",
  "service": "main-app",
  "host": "notes-app-pod",
  "shipper": "sidecar-log-shipper",
  "http": {
    "method": "POST",
    "path": "/api/notes",
    "status": 201,
    "bytes": 184
  },
  "level": "INFO",
  "raw": "172.18.0.1 - - [15/Jun/2026:00:01:00 +0000] \"POST /api/notes HTTP/1.1\" 201 184"
}
```

**Shared volume:** `/var/log/app` — main-app writes `app.log`, sidecar reads it.

**Real-world equivalents:** Fluent Bit, Fluentd, Filebeat, Promtail, Vector.

---

### `sidecar-metrics-exporter`

**Source:** `apps/sidecar-metrics-exporter/src/metrics-exporter.js`

**Pattern:** Adapter

**How it works:**
1. Every 5 seconds, calls `http://localhost:3000/metrics` (shared network namespace)
2. Parses each Prometheus metric line
3. Adds Kubernetes-style labels: `pod`, `namespace`, `service`
4. Appends sidecar self-metrics (`sidecar_scrape_errors_total`, `sidecar_last_scrape_timestamp`)
5. Exposes the enriched metrics at `:9090/metrics`
6. Serves an auto-refreshing HTML dashboard at `:9090/dashboard`

**Why use a sidecar for this?**
The main app doesn't need to know about Prometheus label conventions, pod names, or namespace metadata. The sidecar handles that enrichment, and the main app stays clean.

**Example enriched metric:**
```
# Before (from main-app)
app_requests_total 42

# After (from sidecar, with Kubernetes labels)
app_requests_total{pod="notes-app-abc123",namespace="production",service="main-app"} 42
```

**Endpoints:**
- `GET :9090/metrics` — Prometheus text format
- `GET :9090/dashboard` — HTML dashboard (auto-refreshes every 5s)
- `GET :9090/health` — sidecar health, returns 503 if main app hasn't been scrapeable recently

**Real-world equivalents:** `prometheus/mysqld_exporter`, `prometheus/node_exporter`, Datadog Agent, OpenTelemetry Collector.

## Kubernetes Configuration

See `k8s/sidecar-containers-demo.yaml` for the full manifest. Key excerpt:

```yaml
spec:
  volumes:
    - name: app-logs
      emptyDir: {}     # main-app writes, log-shipper reads

  containers:
    - name: main-app
      image: main-app:latest
      ports:
        - containerPort: 3000
      volumeMounts:
        - name: app-logs
          mountPath: /var/log/app    # writes logs here

    - name: sidecar-log-shipper
      image: sidecar-log-shipper:latest
      volumeMounts:
        - name: app-logs
          mountPath: /var/log/app    # reads same volume

    - name: sidecar-metrics-exporter
      image: sidecar-metrics-exporter:latest
      ports:
        - containerPort: 9090
      env:
        - name: MAIN_APP_HOST
          value: localhost           # same network namespace!
```

### Prometheus Scraping Annotations

Add these to the pod metadata to enable Prometheus auto-discovery:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    prometheus.io/path: "/metrics"
```

## Kubernetes 1.29+ Native Sidecar Pattern

Kubernetes 1.29 introduced **native sidecar support** via `initContainers` with `restartPolicy: Always`:

```yaml
initContainers:
  - name: sidecar-log-shipper
    restartPolicy: Always   # ← makes this a "sidecar init container"
    image: sidecar-log-shipper:latest
    # starts before main containers, stops after main containers
```

**Advantages over `containers[]` approach:**
- Sidecar starts **before** main containers (useful for service mesh proxies)
- Sidecar terminates **after** main containers (proper drain/shutdown order)
- Kubernetes clearly marks it as a sidecar in `kubectl describe`
- Works with Jobs (sidecar exits when main container finishes)

The `containers[]` approach in this project works on all Kubernetes versions (1.18+).

## Docker Compose Approximation

In Docker Compose, sidecars are regular services that `depends_on` the main app:

```yaml
sidecar-log-shipper:
  build: ./apps/sidecar-log-shipper
  volumes:
    - app-logs:/var/log/app    # same volume as main-app
  depends_on:
    main-app:
      condition: service_healthy
  restart: unless-stopped
```

The key difference from Kubernetes: in Compose, sidecars use the service name (`main-app`) to reach the main app over the Compose network. In Kubernetes pods, they use `localhost`.
