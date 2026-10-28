# PRISM Desktop DAW

PRISM is an offline-first Electron music studio for organizing releases and producing individual songs on a desktop computer.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/prism-desktop run dev` — launch the PRISM desktop app in development
- `pnpm --filter @workspace/prism-desktop run typecheck` — typecheck the Electron app
- `pnpm --filter @workspace/prism-desktop run build` — build the Electron main, preload, and renderer bundles
- `pnpm --filter @workspace/prism-desktop run package:win` — create the Windows installer on a compatible build host
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/prism-desktop/src/main` — Electron main process, IPC, local file persistence
- `artifacts/prism-desktop/src/preload` — narrow renderer bridge; keep Node.js unavailable to UI code
- `artifacts/prism-desktop/src/renderer` — React project library, release views, and workstation
- `artifacts/prism-desktop/src/shared/types.ts` — release, song-session, and IPC types
- `artifacts/prism-desktop/README.md` — desktop development, packaging, and current limitations
- `.github/workflows/prism-desktop-windows.yml` — Windows installer build job

## Architecture decisions

- PRISM is a real Electron desktop application, not a website with desktop packaging deferred.
- Core project metadata and media live under Electron's local application-data directory; core project work does not require accounts, a hosted database, or internet access.
- The renderer uses context isolation, a sandboxed preload, disabled Node integration, and allowlisted IPC calls.
- Keep unsupported audio capabilities visibly unavailable; do not imply recording, native plug-ins, advanced low-latency drivers, MIDI instruments, or export work until implemented and verified.
- Use the supplied official PRISM logo only. If it is not available, request it rather than making a replacement.

## Product

The project library is PRISM's opening screen. Singles open their song session directly; multi-track releases open an overview with independent song sessions. The Shop remains a navigation destination and shows “Still In Development! :D”.

## User preferences

- Treat PRISM as a downloadable, offline-capable desktop application from the start.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
