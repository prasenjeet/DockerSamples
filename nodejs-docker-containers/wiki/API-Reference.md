# API Reference

The `main-app` service exposes a REST API on port `3000`.

## Base URL

```
http://localhost:3000
```

---

## Health

### `GET /health`

Returns application health status and the config object loaded from the `init-config-generator` volume.

**Response `200 OK`:**
```json
{
  "status": "healthy",
  "uptime": 142,
  "config": {
    "appName": "Notes App",
    "version": "1.0.0",
    "environment": "development",
    "generatedAt": "2026-06-15T00:00:00.000Z",
    "generatedBy": "init-config-generator",
    "features": {
      "notes-delete": true,
      "notes-tags": true
    },
    "logging": { "level": "debug", "format": "pretty" },
    "limits": { "maxNotesPerRequest": 1000, "maxContentLength": 10000 }
  }
}
```

---

## Metrics

### `GET /metrics`

Prometheus text-format metrics. Scraped by the `sidecar-metrics-exporter` container.

**Response `200 OK` (`text/plain`):**
```
# HELP app_requests_total Total number of HTTP requests
# TYPE app_requests_total counter
app_requests_total 57

# HELP app_request_errors_total Total number of HTTP errors
# TYPE app_request_errors_total counter
app_request_errors_total 2

# HELP app_notes_created_total Total notes created
# TYPE app_notes_created_total counter
app_notes_created_total 3

# HELP app_uptime_seconds Application uptime in seconds
# TYPE app_uptime_seconds gauge
app_uptime_seconds 142
```

---

## Notes

All Notes endpoints are under `/api/notes`.

### Note Object

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "My Note",
  "content": "Note content goes here",
  "tags": ["example", "docker"],
  "created_at": "2026-06-15T00:00:00.000Z",
  "updated_at": "2026-06-15T00:00:00.000Z"
}
```

---

### `GET /api/notes`

Returns all notes ordered by creation time (newest first).

**Response `200 OK`:**
```json
{
  "notes": [ /* array of Note objects */ ],
  "total": 3
}
```

**Example:**
```bash
curl http://localhost:3000/api/notes
```

---

### `GET /api/notes/:id`

Returns a single note by UUID.

**Path parameter:** `id` — UUID of the note

**Response `200 OK`:** Note object

**Response `404 Not Found`:**
```json
{ "error": "Note not found" }
```

**Example:**
```bash
curl http://localhost:3000/api/notes/550e8400-e29b-41d4-a716-446655440000
```

---

### `POST /api/notes`

Creates a new note.

**Request body (`application/json`):**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Note title (max 255 chars) |
| `content` | string | Yes | Note body text |

**Response `201 Created`:** Created Note object

**Response `400 Bad Request`:**
```json
{ "error": "title and content are required" }
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"title": "Docker Patterns", "content": "Init and sidecar containers are powerful."}'
```

---

### `DELETE /api/notes/:id`

Deletes a note by UUID.

**Path parameter:** `id` — UUID of the note

**Response `200 OK`:**
```json
{ "deleted": "550e8400-e29b-41d4-a716-446655440000" }
```

**Response `404 Not Found`:**
```json
{ "error": "Note not found" }
```

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/notes/550e8400-e29b-41d4-a716-446655440000
```

---

## Sidecar Metrics Exporter (port 9090)

These endpoints are served by the `sidecar-metrics-exporter` container, not by `main-app`.

### `GET :9090/metrics`

Prometheus-format metrics enriched with pod/namespace/service labels.

```bash
curl http://localhost:9090/metrics
```

### `GET :9090/dashboard`

HTML dashboard showing all current metric values. Auto-refreshes every 5 seconds.

```bash
open http://localhost:9090/dashboard
```

### `GET :9090/health`

Sidecar health check. Returns `503` if the main app hasn't been successfully scraped recently.

```json
{
  "status": "healthy",
  "lastScrape": 1749945660000,
  "scrapeErrors": 0
}
```
