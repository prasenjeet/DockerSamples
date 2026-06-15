# Architecture

## Container Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Docker Compose / Kubernetes Pod                  │
│                                                                      │
│  ╔══════════════════════════════════════════════════════════════╗   │
│  ║              PHASE 1 — INIT CONTAINERS                       ║   │
│  ║       (sequential, must exit 0 before Phase 2 starts)        ║   │
│  ║                                                              ║   │
│  ║  ┌─────────────────────────┐                                ║   │
│  ║  │  init-config-generator  │                                ║   │
│  ║  │                         │                                ║   │
│  ║  │  Reads: env vars        │──── writes ──► /etc/app-config ║   │
│  ║  │  Writes: JSON config,   │                   (volume)     ║   │
│  ║  │          nginx upstream │                                ║   │
│  ║  │  Exits: 0               │                                ║   │
│  ║  └─────────────────────────┘                                ║   │
│  ║              │ completed successfully                        ║   │
│  ║              ▼                                               ║   │
│  ║  ┌─────────────────────────┐                                ║   │
│  ║  │   init-db-migrator      │                                ║   │
│  ║  │                         │                                ║   │
│  ║  │  1. Poll postgres:5432  │◄──────── postgres (healthy)   ║   │
│  ║  │  2. CREATE TABLE notes  │                                ║   │
│  ║  │  3. Run migrations      │                                ║   │
│  ║  │  4. Seed initial rows   │                                ║   │
│  ║  │  Exits: 0               │                                ║   │
│  ║  └─────────────────────────┘                                ║   │
│  ╚══════════════════════════════════════════════════════════════╝   │
│                   │ both init containers done                        │
│                   ▼                                                  │
│  ╔══════════════════════════════════════════════════════════════╗   │
│  ║              PHASE 2 — MAIN + SIDECAR CONTAINERS            ║   │
│  ║           (all start together, share network + volumes)      ║   │
│  ║                                                              ║   │
│  ║  ┌──────────────────┐  ┌─────────────────┐  ┌───────────┐  ║   │
│  ║  │    main-app      │  │ sidecar-log-    │  │ sidecar-  │  ║   │
│  ║  │    :3000         │  │ shipper         │  │ metrics-  │  ║   │
│  ║  │                  │  │                 │  │ exporter  │  ║   │
│  ║  │  GET  /health    │  │ tail app.log ◄──┼──│  :9090    │  ║   │
│  ║  │  GET  /metrics ──┼──┼────────────────►│  │           │  ║   │
│  ║  │  GET  /api/notes │  │ parse & enrich  │  │ scrape    │  ║   │
│  ║  │  POST /api/notes │  │ ship as JSON    │  │ localhost │  ║   │
│  ║  │                  │  │                 │  │ :3000     │  ║   │
│  ║  │  ► reads config  │  │                 │  │           │  ║   │
│  ║  │    from volume   │  │                 │  │ expose    │  ║   │
│  ║  │  ► writes logs   │  │                 │  │ :9090/    │  ║   │
│  ║  │    to volume     │  │                 │  │ metrics   │  ║   │
│  ║  │  ► queries DB    │  │                 │  │ dashboard │  ║   │
│  ║  └────────┬─────────┘  └─────────────────┘  └───────────┘  ║   │
│  ║           │                                                  ║   │
│  ╚═══════════│══════════════════════════════════════════════════╝   │
│              │                                                       │
│              ▼                                                       │
│         postgres:5432                                                │
│         (persistent volume)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Shared Resources

### Volumes

| Volume | Writer | Reader | Purpose |
|---|---|---|---|
| `app-config` | `init-config-generator` | `main-app` (read-only) | Runtime config JSON generated before startup |
| `app-logs` | `main-app` | `sidecar-log-shipper` | Log file tailed by the log shipper sidecar |
| `postgres-data` | `postgres` | `postgres` | Persistent database storage |

### Network (Docker Compose)

All services share the same Compose network. In Kubernetes all containers in a pod share the same network namespace, so sidecars use `localhost` to reach the main app.

| In Docker Compose | In Kubernetes |
|---|---|
| `http://main-app:3000` | `http://localhost:3000` |
| `http://postgres:5432` | `http://postgres-service:5432` |

## Startup Dependency Graph

```
postgres
  └──(healthy)──► init-config-generator
                       └──(exit 0)──► init-db-migrator
                                           └──(exit 0)──► main-app
                                                            ├──(healthy)──► sidecar-log-shipper
                                                            └──(healthy)──► sidecar-metrics-exporter
```

Enforced in Docker Compose via:
```yaml
depends_on:
  some-service:
    condition: service_completed_successfully  # init containers
    condition: service_healthy                 # main app before sidecars
```

Enforced in Kubernetes via:
- `spec.initContainers[]` (run sequentially, must exit 0)
- `spec.containers[]` readiness probes (sidecars wait until main app is ready)

## Port Map

| Host Port | Container | Endpoint |
|---|---|---|
| `3000` | `main-app` | REST API + `/health` + `/metrics` |
| `5432` | `postgres` | PostgreSQL |
| `9090` | `sidecar-metrics-exporter` | Prometheus `/metrics` + `/dashboard` |
