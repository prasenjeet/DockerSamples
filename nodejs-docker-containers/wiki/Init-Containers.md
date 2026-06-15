# Init Containers

## What is an Init Container?

An init container is a container that:

1. **Runs before** any main application container starts
2. **Must complete successfully** (exit code 0) — if it fails, Kubernetes restarts the whole pod
3. **Runs sequentially** — multiple init containers run one after another, not in parallel
4. **Has access to the same volumes and secrets** as the main containers

Think of them as the setup step before the party starts. The guests (main containers) only arrive after the setup crew (init containers) packs up and leaves.

## When to Use Init Containers

| Scenario | Why an init container? |
|---|---|
| **Dependency readiness** | Poll until a database, message broker, or API is ready before the app starts trying to connect |
| **Database migrations** | Run `ALTER TABLE` before the app that uses those columns starts |
| **Config generation** | Render templates, fetch secrets from Vault, write config files to a shared volume |
| **Permission setup** | `chown` volumes, create directories the main app expects |
| **Pre-flight checks** | Validate required environment variables, network connectivity, license keys |
| **Data seeding** | Load initial data that the app assumes exists |

## Init Container vs. App Startup Logic

| | Init Container | App Startup Logic |
|---|---|---|
| Failure handling | Pod restart (clean retry) | App crash loop |
| Image | Can use a different, minimal image | Must be in the app image |
| Separation of concerns | DB team owns migration container | App team doesn't need to know |
| Visibility | Separate logs, separate lifecycle | Mixed with app logs |
| Runs once | Yes — never restarts after success | Runs every time the app restarts |

## This Project's Init Containers

### `init-config-generator`

**Source:** `apps/init-config-generator/src/generate-config.js`

**What it does:**
- Reads environment variables (`APP_ENV`, `APP_VERSION`, `FEATURE_FLAGS`, etc.)
- Generates a typed `app-config.json` with runtime settings
- Writes an nginx upstream config
- Writes a `.init-complete` marker file
- Exits with code 0

**Volume written:** `/etc/app-config` → read by `main-app` at startup

**Example output (`app-config.json`):**
```json
{
  "appName": "Notes App",
  "version": "1.0.0",
  "environment": "development",
  "generatedAt": "2026-06-15T00:00:00.000Z",
  "generatedBy": "init-config-generator",
  "features": {
    "notes-delete": true,
    "notes-tags": true,
    "dark-mode": true
  },
  "logging": { "level": "debug", "format": "pretty" },
  "limits": { "maxNotesPerRequest": 1000, "maxContentLength": 10000 }
}
```

**Real-world equivalents:** Consul Template, Vault Agent, AWS Secrets Manager sidecar, `envsubst` on config templates.

---

### `init-db-migrator`

**Source:** `apps/init-db-migrator/src/migrate.js`

**What it does:**
1. **Polls PostgreSQL** until it accepts TCP connections (up to 30 retries × 2 s)
2. **Creates tables** if they don't exist (`CREATE TABLE IF NOT EXISTS`)
3. **Tracks applied migrations** in a `schema_migrations` table
4. **Runs pending migrations** in order (idempotent — skips already-applied ones)
5. **Seeds initial data** if the `notes` table is empty
6. Exits with code 0

**Example output:**
```
[init-db-migrator] Waiting for PostgreSQL at postgres:5432...
[init-db-migrator] Attempt 1/30 failed: connect ECONNREFUSED
[init-db-migrator] Attempt 2/30 failed: connect ECONNREFUSED
[init-db-migrator] PostgreSQL is ready (attempt 3)
[init-db-migrator] Running migrations...
[init-db-migrator] Migration 001_create_notes: applied
[init-db-migrator] Migration 002_add_tags_column: applied
[init-db-migrator] Seeding initial data...
[init-db-migrator] Seeded note: "Welcome to Notes App"
[init-db-migrator] Seeded note: "Docker Container Patterns"
[init-db-migrator] Done — exiting with code 0
```

**Real-world equivalents:** Flyway, Liquibase, `golang-migrate`, Alembic, Rails `db:migrate`.

## Kubernetes Configuration

See `k8s/init-containers-demo.yaml` for the full manifest. Key excerpt:

```yaml
spec:
  volumes:
    - name: app-config
      emptyDir: {}      # shared between init and main containers

  initContainers:
    - name: init-config-generator
      image: init-config-generator:latest
      volumeMounts:
        - name: app-config
          mountPath: /etc/app-config   # writes here

    - name: init-db-migrator
      image: init-db-migrator:latest
      # No volumeMounts needed — just needs DB env vars

  containers:
    - name: main-app
      image: main-app:latest
      volumeMounts:
        - name: app-config
          mountPath: /etc/app-config
          readOnly: true              # reads what init wrote
```

### Key Rules
- Init containers under `spec.initContainers[]` run **before** any container in `spec.containers[]`
- They run **in the order listed** — `init-config-generator` completes before `init-db-migrator` starts
- They share the same pod volumes as main containers
- They do **not** share the network namespace with each other during their run

## Docker Compose Equivalent

Docker Compose doesn't have native init containers, but `depends_on` with `condition: service_completed_successfully` provides the same guarantee:

```yaml
services:
  init-db-migrator:
    # ... runs migrations, exits 0

  main-app:
    depends_on:
      init-db-migrator:
        condition: service_completed_successfully   # ← the key
```

Compose will wait for `init-db-migrator` to exit with code 0 before starting `main-app`.

## Kubernetes 1.29+ Native Sidecar Init Containers

Kubernetes 1.29 introduced a new sidecar pattern using `initContainers` with `restartPolicy: Always`. This is different from what's described here — see the [Sidecar Containers](Sidecar-Containers) page for details.
