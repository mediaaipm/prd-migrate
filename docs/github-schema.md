GitHub schema & PRD file format
================================

This document defines the repository layout, file naming, and PRD frontmatter to use as the single source-of-truth for ProductGraph OS (MVP).

Repository layout
-----------------

- `prds/` — product PRDs and feature documents
- `products/` — product-level metadata (optional)
- `teams/` — team ownership files
- `graphify/` — generated outputs (`graph.json`, `graph.html`)
- `scripts/` — helpers and generators (e.g., `generate_graph.py`)
- `api/` — serverless function scaffolding for Vercel

File naming
-----------

- PRDs: `PRD-<PRODUCT>-<NNN>.md` or `<PRODUCT>-<NNN>.md` (example: `AUTH-001.md`)
- Product metadata: `<product>.yml` under `products/`
- Team files: `<team-name>.md` under `teams/`

PRD frontmatter / metadata (YAML)
--------------------------------

Use a YAML frontmatter block at the top of each PRD for machine parsing and Graphify.

Example:

---
id: AUTH-001
title: Authentication System
version: 1.0.0
status: draft
owner: platform-team
depends_on:
  - USER-001
  - API-004
affects:
  - mobile-app
  - admin-panel
tags:
  - auth
  - security
created: 2026-05-16
---

Followed by the Markdown body describing goals, scope, API, and design.

Guidelines
----------

- Keep metadata compact and canonical — use IDs for references (e.g., `USER-001`).
- Prefer dash-list for arrays in YAML frontmatter (`depends_on`/`affects`).
- When linking to another PRD, reference its `id` in metadata; include a Markdown link to the file in the body.
- Update the `version` using semantic versioning for every meaningful change.

Commit conventions
------------------

- Commit message: `prds: AUTH-001 bump to 1.0.1` or `prd: add AUTH-002`.
- Tag releases by creating a lightweight tag in Git when a PRD reaches a release milestone.

Next steps
----------

- Add a `scripts/validate_prd.py` to enforce schema and metadata rules.
- Update `generate_graph.py` to parse YAML frontmatter across `prds/` and `products/`.
