# Node.js Docker Container Patterns

A practical Node.js sample project demonstrating two fundamental Docker/Kubernetes container design patterns: **Init Containers** and **Sidecar Containers**.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Pod / Compose Stack                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   INIT CONTAINERS                         │   │
│  │   (run once, sequentially, exit 0 before main starts)    │   │
│  │                                                           │   │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐  │   │
│  │  │ init-config-        │  │  init-db-migrator        │  │   │
│  │  │ generator           │  │                          │  │   │
│  │  │                     │  │  1. Poll until Postgres  │  │   │
│  │  │ Writes runtime      │  │     is ready             │  │   │
│  │  │ config JSON to      │  │  2. Run schema           │  │   │
│  │  │ shared volume       │  │     migrations           │  │   │
│  │  │                     │  │  3. Seed initial data    │  │   │
│  │  │ Exit 0              │  │  4. Exit 0               │  │   │
│  │  └────────┬────────────┘  └──────────────────────────┘  │   │
│  └───────────┼──────────────────────────────────────────────┘   │
│              │ /etc/app-config volume                            │
│              ▼                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              MAIN CONTAINER + SIDECARS                    │   │
│  │         (all start together, share network + volumes)     │   │
│  │                                                           │   │
│  │  ┌────────────────┐  ┌───────────────┐  ┌─────────────┐ │   │
│  │  │   main-app     │  │  sidecar-     │  │  sidecar-   │ │   │
│  │  │   :3000        │  │  log-shipper  │  │  metrics-   │ │   │
│  │  │                │  │               │  │  exporter   │ │   │
│  │  │ Express API    │  │ Tails         │  │  :9090      │ │   │
│  │  │ GET /api/notes │  │ /var/log/app/ │  │             │ │   │
│  │  │ POST /api/notes│  │ app.log,      │  │ Scrapes     │ │   │
│  │  │ GET /health    │  │ parses &      │  │ localhost:  │ │   │
│  │  │ GET /metrics   │  │ enriches logs │  │ 3000/metrics│ │   │
│  │  │                │  │               │  │             │ │   │
│  │  │ Writes logs ──►│  │◄── reads ─────┤  │ Exposes     │ │   │
│  │  │ to volume      │  │               │  │ enriched    │ │   │
│  │  │                │  │ Ships to      │  │ Prometheus  │ │   │
│  │  │ Reads config   │  │ stdout as     │  │ metrics     │ │   │
│  │  │ from volume    │  │ structured    │  │ + dashboard │ │   │
│  │  │                │  │ JSON          │  │             │ │   │
│  │  └────────────────┘  └───────────────┘  └─────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Shared Volumes:
  app-config   /etc/app-config  ← init-config-generator writes, main-app reads
  app-logs     /var/log/app     ← main-app writes, sidecar-log-shipper reads
```

## Container Patterns Explained

### Init Containers

Init containers run **sequentially** and **to completion** before any main container starts. They are ideal for:

| Use Case | This Project |
|---|---|
| Dependency readiness checks | `init-db-migrator` polls Postgres until it accepts connections |
| Database migrations | `init-db-migrator` runs `CREATE TABLE` and schema changes |
| Data seeding | `init-db-migrator` seeds initial rows if the table is empty |
| Config/secret generation | `init-config-generator` writes `app-config.json` to a shared volume |
| Pre-flight validation | Validate environment variables before spending money starting the app |

**Key property:** If an init container fails, Kubernetes restarts the pod. The main app **never starts** if any init container exits with a non-zero code.

### Sidecar Containers

Sidecar containers run **alongside** the main container, sharing:
- **Network namespace** → sidecars call `localhost` to reach the main app
- **Volumes** → sidecars read/write files shared with the main app
- **Pod lifecycle** → they start and stop together

| Sidecar | Pattern | What it does |
|---|---|---|
| `sidecar-log-shipper` | Log Aggregation | Tails `app.log`, parses Apache format, enriches with metadata, ships as structured JSON |
| `sidecar-metrics-exporter` | Adapter / Ambassador | Scrapes `localhost:3000/metrics`, adds Kubernetes labels, exposes Prometheus endpoint + HTML dashboard on `:9090` |

## Project Structure

```
nodejs-docker-containers/
├── apps/
│   ├── main-app/                    # Express.js REST API (notes CRUD)
│   │   ├── src/
│   │   │   ├── app.js               # Server, health, metrics endpoints
│   │   │   └── routes/notes.js      # Notes CRUD with PostgreSQL
│   │   └── Dockerfile
│   │
│   ├── init-db-migrator/            # Init container #1: DB setup
│   │   ├── src/migrate.js           # Wait → migrate → seed → exit 0
│   │   └── Dockerfile
│   │
│   ├── init-config-generator/       # Init container #2: Config generation
│   │   ├── src/generate-config.js   # Write JSON config to shared volume
│   │   └── Dockerfile
│   │
│   ├── sidecar-log-shipper/         # Sidecar #1: Log aggregation
│   │   ├── src/log-shipper.js       # Tail file → parse → enrich → ship
│   │   └── Dockerfile
│   │
│   └── sidecar-metrics-exporter/    # Sidecar #2: Metrics adapter
│       ├── src/metrics-exporter.js  # Scrape → label → expose :9090
│       └── Dockerfile
│
├── k8s/
│   ├── init-containers-demo.yaml    # K8s Pod with initContainers[]
│   └── sidecar-containers-demo.yaml # K8s Pod with sidecar containers[]
│
├── scripts/
│   └── demo.sh                      # End-to-end demo script
│
└── docker-compose.yml               # Full stack demo
```

## Quick Start

### Prerequisites

- Docker Engine 24+
- Docker Compose v2.20+

### Run the full stack

```bash
cd nodejs-docker-containers

# Build and start everything
docker compose up --build

# In another terminal, run the demo
./scripts/demo.sh
```

### Observe the patterns

**Watch init containers complete before main-app starts:**
```bash
docker compose logs init-config-generator
docker compose logs init-db-migrator
# Note: main-app logs appear only after both init containers exit 0
```

**Watch the log-shipper sidecar tail and enrich logs:**
```bash
docker compose logs -f sidecar-log-shipper
# Each HTTP request to main-app appears here as structured JSON
```

**View the metrics dashboard:**
```
http://localhost:9090/dashboard
```

**Scrape raw Prometheus metrics:**
```bash
curl http://localhost:9090/metrics
```

**Use the Notes API:**
```bash
# List notes (pre-seeded by init-db-migrator)
curl http://localhost:3000/api/notes

# Create a note
curl -X POST http://localhost:3000/api/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"My Note","content":"Hello from the Notes API"}'

# Health check (shows config loaded from init-config-generator)
curl http://localhost:3000/health
```

### Tear down

```bash
docker compose down -v   # -v removes named volumes (postgres data, logs, config)
```

## Kubernetes Deployment

```bash
# Apply the init containers demo
kubectl apply -f k8s/init-containers-demo.yaml

# Apply the sidecar containers demo (includes init containers too)
kubectl apply -f k8s/sidecar-containers-demo.yaml

# Watch init containers run before the main container starts
kubectl get pod notes-app-init-demo -w

# See all containers in the sidecar pod
kubectl describe pod notes-app-sidecar-demo

# Stream logs from a specific container
kubectl logs notes-app-sidecar-demo -c sidecar-log-shipper -f
kubectl logs notes-app-sidecar-demo -c sidecar-metrics-exporter -f
```

## Pattern Comparison

| | Init Container | Sidecar Container |
|---|---|---|
| **Lifecycle** | Run once, exit before main starts | Run continuously alongside main |
| **Purpose** | Setup, migration, config generation | Logging, metrics, proxying, sync |
| **Restart** | Retried on failure (pod restarts) | Restarted by kubelet like any container |
| **Network** | Isolated (no port sharing yet) | Shares pod network (use `localhost`) |
| **Volumes** | Can write for main to read | Reads/writes shared with main |
| **K8s field** | `spec.initContainers[]` | `spec.containers[]` (or K8s 1.29+ native sidecar) |
| **Docker Compose** | `condition: service_completed_successfully` | Normal service (no condition) |
