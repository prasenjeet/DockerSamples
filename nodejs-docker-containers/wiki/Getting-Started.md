# Getting Started

## Prerequisites

| Tool | Minimum version | Check |
|---|---|---|
| Docker Engine | 24.0 | `docker --version` |
| Docker Compose | v2.20 | `docker compose version` |
| (Optional) kubectl | 1.26 | `kubectl version --client` |

## Clone the Repository

```bash
git clone https://github.com/prasenjeet/DockerSamples.git
cd DockerSamples/nodejs-docker-containers
```

## Run with Docker Compose

### Start the full stack

```bash
docker compose up --build
```

The startup sequence is enforced automatically:

```
[1] postgres              — waits until pg_isready passes
[2] init-config-generator — writes config, exits 0
[3] init-db-migrator      — runs migrations, exits 0
[4] main-app              — starts serving on :3000
[5] sidecar-log-shipper   — starts tailing logs
[6] sidecar-metrics-exporter — starts scraping metrics
```

### Verify everything is up

```bash
docker compose ps
```

Expected output — init containers show `Exited (0)`, everything else `running`:

```
NAME                          STATUS
nodes-init-config-generator   Exited (0)
nodes-init-db-migrator        Exited (0)
nodes-main-app                running (healthy)
nodes-postgres                running (healthy)
nodes-sidecar-log-shipper     running
nodes-sidecar-metrics-exporter running (healthy)
```

### Run the demo script

```bash
./scripts/demo.sh
```

This exercises the full API (list → create → fetch → delete) and prints the raw Prometheus metrics.

## Explore the Running Stack

### API

```bash
# Health — shows config loaded by init-config-generator
curl http://localhost:3000/health

# Notes pre-seeded by init-db-migrator
curl http://localhost:3000/api/notes

# Create a note
curl -X POST http://localhost:3000/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hello","content":"World"}'
```

### Logs

```bash
# Watch the log-shipper sidecar ship enriched JSON
docker compose logs -f sidecar-log-shipper

# Watch init containers run (already exited, shows historical output)
docker compose logs init-db-migrator
docker compose logs init-config-generator
```

### Metrics

```bash
# Prometheus text format
curl http://localhost:9090/metrics

# Human-readable dashboard (auto-refreshes every 5s)
open http://localhost:9090/dashboard
```

### Inspect shared volumes

```bash
# See the config file written by init-config-generator
docker compose exec main-app cat /etc/app-config/app-config.json

# See the log file shared with the log-shipper sidecar
docker compose exec main-app tail -f /var/log/app/app.log
```

## Tear Down

```bash
# Stop containers, remove volumes (wipes DB data)
docker compose down -v

# Stop but keep volumes
docker compose down
```

## Run on Kubernetes

```bash
# Build and push images to your registry first
docker build -t your-registry/init-config-generator:latest apps/init-config-generator
docker build -t your-registry/init-db-migrator:latest      apps/init-db-migrator
docker build -t your-registry/main-app:latest              apps/main-app
docker build -t your-registry/sidecar-log-shipper:latest   apps/sidecar-log-shipper
docker build -t your-registry/sidecar-metrics-exporter:latest apps/sidecar-metrics-exporter

# Apply manifests
kubectl apply -f k8s/init-containers-demo.yaml
kubectl apply -f k8s/sidecar-containers-demo.yaml

# Watch the pod come up (init containers run first)
kubectl get pod notes-app-sidecar-demo -w
```
