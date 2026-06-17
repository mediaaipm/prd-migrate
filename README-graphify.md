Graphify starter
================

This adds a minimal generator and viewer to produce a simple graph.json from `PRD.md` and a static `graph.html` viewer.

Usage
-----

Run the generator (requires Python 3):

```powershell
python scripts\generate_graph.py
```

Then open `graphify/graph.html` in your browser (it will load `graph.json` from the same folder).

Notes
-----
- The parser heuristically extracts `id`, `title`, `version`, `owner`, and `depends_on` lists from `PRD.md`.
- This is a starting point — we can iterate to support YAML frontmatter, multiple files, and richer node types.

Vercel API routes (optional)
---------------------------

Two serverless endpoints are scaffolded under `api/` for Vercel deployments:

- `api/save_prd.js` — POST endpoint to save/update a file in the GitHub repo. Expects JSON `{ path, content, message, branch }`. Requires env vars: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`.
- `api/webhook.js` — GitHub webhook receiver. On `push` events it dispatches a GitHub Actions workflow (env `WORKFLOW_FILE`, default `graphify.yml`) to rebuild the graph.

Set the required environment variables in Vercel or your local dev environment before deploying.

