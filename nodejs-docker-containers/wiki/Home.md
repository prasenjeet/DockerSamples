# Node.js Docker Container Patterns

A practical sample project that demonstrates the two most important Docker/Kubernetes container design patterns using a real Node.js application (a Notes REST API backed by PostgreSQL).

## Patterns Covered

| Pattern | What it does | This project |
|---|---|---|
| **Init Container** | Runs to completion before the main app starts | DB migrations, config generation |
| **Sidecar Container** | Runs alongside the main app, sharing network + volumes | Log shipping, metrics export |

## Wiki Pages

- [Getting Started](Getting-Started) — prerequisites, quick start, teardown
- [Architecture](Architecture) — how all the containers connect
- [Init Containers](Init-Containers) — pattern deep-dive, both examples
- [Sidecar Containers](Sidecar-Containers) — pattern deep-dive, both examples
- [API Reference](API-Reference) — Notes REST API endpoints

## At a Glance

```
postgres (healthy)
    │
    ├─► init-config-generator   writes config JSON → /etc/app-config
    │
    └─► init-db-migrator        waits → migrates → seeds → exits 0
                │
                ▼
            main-app :3000
                │
                ├─── sidecar-log-shipper        tails logs, ships JSON
                └─── sidecar-metrics-exporter   exposes :9090/metrics
```

## Quick Start

```bash
git clone https://github.com/prasenjeet/DockerSamples.git
cd DockerSamples/nodejs-docker-containers
docker compose up --build
./scripts/demo.sh
```

- Main API → http://localhost:3000
- Metrics dashboard → http://localhost:9090/dashboard
