# Obsidian Telegram

Telegram-to-Obsidian sync plugin with a Supabase backend.

This repository is a monorepo for:
- the Obsidian plugin in `plugin/`
- Supabase schema and Edge Functions in `supabase/`
- setup and verification scripts in `scripts/`
- planning docs in `docs/`

## Repository Layout

```text
obsidian-telegram/
├── plugin/
├── supabase/
├── scripts/
└── docs/
```

## Current Status

The repository is scaffolded for the revised architecture:
- server-side Telegram webhook storage
- per-client cursor sync, not global message sync flags
- topic-aware routing
- self-hosted Supabase bootstrap from one repo

## Quick Start

1. Run `npm run verify`.
2. Configure Supabase CLI and project credentials.
3. Run `npm run bootstrap:supabase`.
4. Install plugin dependencies with `npm install --prefix plugin`.
5. Build the plugin with `npm run build:plugin`.

## Notes

- The plugin scaffold follows the official Obsidian sample plugin structure, adapted to live in `plugin/`.
- The implementation plan for this repo is in [docs/plans/2026-03-03-telegram-sync-server-revised.md](docs/plans/2026-03-03-telegram-sync-server-revised.md).
