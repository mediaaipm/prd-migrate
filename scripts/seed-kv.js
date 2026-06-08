/**
 * Seeds Vercel KV with data from the local prds/ directory.
 * Run once after setting up KV: node scripts/seed-kv.js
 * Requires KV_REST_API_URL and KV_REST_API_TOKEN env vars (from .env.local).
 */
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { kv } = require('@vercel/kv');

const DATA_DIR = path.join(__dirname, '..', 'prds');

async function seed() {
  const entries = fs.readdirSync(DATA_DIR).filter(d => {
    const full = path.join(DATA_DIR, d);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'meta.json'));
  });

  for (const slug of entries) {
    const dir = path.join(DATA_DIR, slug);

    // Read versions and proposals to compute denormalized stats
    const versionsDir = path.join(dir, 'versions');
    const proposalsDir = path.join(dir, 'proposals');

    const versionFiles = fs.existsSync(versionsDir)
      ? fs.readdirSync(versionsDir).filter(f => f.endsWith('.json') && !f.includes('-tasks'))
      : [];
    const versionStrings = versionFiles.map(f => f.replace('.json', ''));
    const latestVersion = versionStrings.sort((a, b) => {
      const av = a.split('.').map(Number), bv = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((bv[i]||0) !== (av[i]||0)) return (bv[i]||0) - (av[i]||0);
      return 0;
    })[0] || null;

    const propFiles = fs.existsSync(proposalsDir)
      ? fs.readdirSync(proposalsDir).filter(f => f.endsWith('.json'))
      : [];
    const pendingProposals = propFiles.filter(f => {
      try { return JSON.parse(fs.readFileSync(path.join(proposalsDir, f), 'utf8')).status === 'pending'; }
      catch { return false; }
    }).length;

    // Project meta with denormalized stats
    const rawMeta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const meta = { ...rawMeta, latestVersion, pendingProposals };
    await kv.set(`project:${slug}`, meta);
    await kv.sadd('projects', slug);
    console.log(`project:${slug} (latestVersion=${latestVersion}, pending=${pendingProposals})`);

    // Versions
    const versionsDir = path.join(dir, 'versions');
    if (fs.existsSync(versionsDir)) {
      const versionFiles = fs.readdirSync(versionsDir).filter(f => f.endsWith('.json') && !f.includes('-tasks'));
      for (const f of versionFiles) {
        const ver = JSON.parse(fs.readFileSync(path.join(versionsDir, f), 'utf8'));
        await kv.set(`version:${slug}:${ver.version}`, ver);
        await kv.sadd(`versions:${slug}`, ver.version);
        console.log(`  version:${slug}:${ver.version}`);
      }

      // Version-specific tasks
      const taskFiles = fs.readdirSync(versionsDir).filter(f => f.endsWith('-tasks.json'));
      for (const f of taskFiles) {
        const version = f.replace('-tasks.json', '');
        const tasks = JSON.parse(fs.readFileSync(path.join(versionsDir, f), 'utf8'));
        await kv.set(`tasks:${slug}:${version}`, tasks);
        console.log(`  tasks:${slug}:${version} (${tasks.length} tasks)`);
      }
    }

    // Global tasks
    const globalTasksPath = path.join(dir, 'tasks.json');
    if (fs.existsSync(globalTasksPath)) {
      const tasks = JSON.parse(fs.readFileSync(globalTasksPath, 'utf8'));
      await kv.set(`tasks:${slug}:__root`, tasks);
      console.log(`  tasks:${slug}:__root (${tasks.length} tasks)`);
    }

    // Proposals
    const proposalsDir = path.join(dir, 'proposals');
    if (fs.existsSync(proposalsDir)) {
      const propFiles = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.json'));
      for (const f of propFiles) {
        const prop = JSON.parse(fs.readFileSync(path.join(proposalsDir, f), 'utf8'));
        await kv.set(`proposal:${slug}:${prop.id}`, prop);
        await kv.sadd(`proposals:${slug}`, prop.id);
        console.log(`  proposal:${slug}:${prop.id}`);
      }
    }
  }

  console.log('\nSeed complete.');
}

seed().catch(err => { console.error(err); process.exit(1); });
