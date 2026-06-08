PRD Editor UI (Next.js)
=======================

This is a minimal Next.js scaffold for the PRD editor UI. It is intentionally small to act as a starting point.

Quick start
-----------

Install dependencies and run the dev server:

```powershell
npm install
npm run dev
```

Notes
-----
- The editor posts to `/api/save_prd` — this endpoint is implemented as a Vercel serverless function in `api/save_prd.js` for deployments on Vercel. For local Next.js development you may need to proxy or adapt the API.
- This scaffold is intentionally simple; next steps: integrate authentication, YAML frontmatter form, and file listing.
