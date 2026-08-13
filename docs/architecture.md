# Architecture

## System shape

Drop is deployed on one origin:

```text
Browser -> drop.28207.cc -> Worker
                              |-- Static Assets (Vue SPA)
                              |-- D1 (metadata and state)
                              `-- Private R2 (file bytes)
```

The Worker is the only authorization boundary. Browsers never connect directly
to D1 and never receive Cloudflare API or R2 credentials. R2 remains private in
every phase.

## Responsibilities

- Vue renders the owner and public user interfaces.
- Hono routes `/api/*` requests inside the Worker.
- Workers Static Assets serves the built SPA with history fallback.
- D1 stores metadata, authentication records, and business state.
- R2 stores file bytes under generated, non-user-controlled object keys.

## Performance invariants

Large request and response bodies flow as streams. Files larger than the
configured chunk size use R2 multipart uploads. Worker code must not buffer a
complete large file, hash a complete large file, transcode media, or scan an
entire database table.

## Delivery phases

Phase 00 establishes the toolchain, bindings, tests, and health endpoint.
Phases 01 through 06 deliver the MVP in dependency order: authentication,
single upload, multipart upload, download, sharing, and cleanup. Later phases
are enhancements and cannot be pulled into an earlier phase implicitly.
