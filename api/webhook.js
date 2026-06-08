// Vercel Serverless function: webhook
// Handles GitHub webhook events and triggers graph rebuild via GitHub Actions workflow dispatch.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const event = req.headers['x-github-event'];
  const OWNER = process.env.GITHUB_OWNER;
  const REPO = process.env.GITHUB_REPO;
  const TOKEN = process.env.GITHUB_TOKEN;
  const WORKFLOW_FILE = process.env.WORKFLOW_FILE || 'graphify.yml';
  const REF = process.env.WORKFLOW_REF || 'main';

  if (!OWNER || !REPO || !TOKEN) {
    return res.status(500).json({ error: 'Missing GITHUB_OWNER, GITHUB_REPO or GITHUB_TOKEN env vars' });
  }

  // Simple handling: on push, dispatch the graphify workflow to regenerate artifacts.
  try {
    if (event === 'push') {
      const dispatchUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
      const headers = { Authorization: `token ${TOKEN}`, 'User-Agent': 'productgraph-os', Accept: 'application/vnd.github.v3+json' };
      const body = JSON.stringify({ ref: REF });
      const r = await fetch(dispatchUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body });
      if (r.status === 204) {
        return res.status(200).json({ ok: true, message: 'Workflow dispatched' });
      }
      const text = await r.text();
      return res.status(r.status).json({ ok: false, detail: text });
    }

    // For other events, acknowledge.
    return res.status(200).json({ ok: true, event });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
