// Vercel Serverless function: save_prd
// Expects JSON POST: { path, content, message, branch }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { path, content, message, branch } = req.body || {};
  const OWNER = process.env.GITHUB_OWNER;
  const REPO = process.env.GITHUB_REPO;
  const TOKEN = process.env.GITHUB_TOKEN;

  if (!OWNER || !REPO || !TOKEN) {
    return res.status(500).json({ error: 'Missing GITHUB_OWNER, GITHUB_REPO or GITHUB_TOKEN env vars' });
  }

  if (!path || typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing path or content' });
  }

  const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`;
  const headers = { Authorization: `token ${TOKEN}`, 'User-Agent': 'productgraph-os', Accept: 'application/vnd.github.v3+json' };

  try {
    // Try to get existing file to obtain SHA
    const getRes = await fetch(apiBase + (branch ? `?ref=${branch}` : ''), { headers });
    let sha;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    const body = {
      message: message || `Update ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: branch || 'main',
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiBase, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const putJson = await putRes.json();
    if (!putRes.ok) return res.status(putRes.status).json(putJson);
    return res.status(200).json(putJson);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
