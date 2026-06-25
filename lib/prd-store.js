const { Redis } = require('@upstash/redis');
let _kv;
function getKv() { if (!_kv) _kv = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }); return _kv; }

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Task id prefix shown before the per-project sequence (e.g. ENG -> ENG-1).
// Uppercase alphanumeric, max 8 chars. Empty string clears it.
function normalizeTaskPrefix(prefix) {
  if (prefix == null) return '';
  return String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  const [major, minor, patch] = parts;
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function sortVersionsDesc(versions) {
  return versions.sort((a, b) => {
    const av = a.version.split('.').map(Number);
    const bv = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((bv[i] || 0) !== (av[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
    }
    return 0;
  });
}

function latestFromVersionStrings(ids) {
  if (!ids || !ids.length) return null;
  return [...ids].sort((a, b) => {
    const av = a.split('.').map(Number);
    const bv = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((bv[i] || 0) !== (av[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
    }
    return 0;
  })[0];
}

// Recomputes and saves latestVersion + pendingProposals onto the project meta.
// Call after any version or proposal mutation.
async function refreshProjectStats(slug) {
  const meta = await getKv().get(`project:${slug}`);
  if (!meta) return;

  const [versionIds, proposalIds] = await Promise.all([
    getKv().smembers(`versions:${slug}`),
    getKv().smembers(`proposals:${slug}`),
  ]);

  const latestVersion = latestFromVersionStrings(versionIds);

  let pendingProposals = 0;
  if (proposalIds && proposalIds.length) {
    const proposals = await getKv().mget(...proposalIds.map(id => `proposal:${slug}:${id}`));
    pendingProposals = proposals.filter(p => p && p.status === 'pending').length;
  }

  await getKv().set(`project:${slug}`, { ...meta, latestVersion, pendingProposals });
}

// --- Projects ---

async function listProjects() {
  const slugs = await getKv().smembers('projects');
  if (!slugs || !slugs.length) return [];
  // Single mget for all project metas — stats are denormalized onto the meta
  const metas = await getKv().mget(...slugs.map(s => `project:${s}`));
  return metas
    .map((meta, i) => meta ? { ...meta, slug: slugs[i] } : null)
    .filter(Boolean);
}

async function getProject(slug) {
  const meta = await getKv().get(`project:${slug}`);
  if (!meta) return null;
  const [versions, proposals] = await Promise.all([listVersions(slug), listProposals(slug)]);
  return { ...meta, slug, versions, proposals };
}

async function createProject(name, description, { status, priority, members, taskPrefix } = {}) {
  const slug = slugify(name);
  const initVersion = '1.0.0';
  const meta = {
    id: slug, name, description: description || '',
    status: status || 'active',
    priority: priority || 'medium',
    members: Array.isArray(members) ? members : [],
    taskPrefix: normalizeTaskPrefix(taskPrefix),
    createdAt: new Date().toISOString(),
    latestVersion: initVersion,
    pendingProposals: 0,
  };
  const versionData = {
    version: initVersion,
    createdAt: new Date().toISOString(),
    content: `# ${name}\n\n## Overview\n\n${description || ''}\n\n## Features\n\n- \n\n## Requirements\n\n- \n`,
  };
  await Promise.all([
    getKv().set(`project:${slug}`, meta),
    getKv().sadd('projects', slug),
    getKv().set(`version:${slug}:${initVersion}`, versionData),
    getKv().sadd(`versions:${slug}`, initVersion),
  ]);
  return { ...meta, slug };
}

function normalizeTaskAcl(acl) {
  if (!acl || typeof acl !== 'object') return null;
  const out = {};
  if (typeof acl.assigneeCanChangeStatus === 'boolean') out.assigneeCanChangeStatus = acl.assigneeCanChangeStatus;
  if (Array.isArray(acl.assigneeStatuses)) out.assigneeStatuses = acl.assigneeStatuses.filter(s => typeof s === 'string');
  else if (acl.assigneeStatuses === null) out.assigneeStatuses = null;
  return Object.keys(out).length ? out : null;
}

async function updateProject(slug, { name, description, status, priority, members, taskAcl, taskPrefix }) {
  const meta = await getKv().get(`project:${slug}`);
  if (!meta) return null;
  const updated = {
    ...meta,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(members !== undefined ? { members: Array.isArray(members) ? members : [] } : {}),
    ...(taskAcl !== undefined ? { taskAcl: normalizeTaskAcl(taskAcl) } : {}),
    ...(taskPrefix !== undefined ? { taskPrefix: normalizeTaskPrefix(taskPrefix) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await getKv().set(`project:${slug}`, updated);
  return { ...updated, slug };
}

async function deleteProject(slug) {
  const meta = await getKv().get(`project:${slug}`);
  if (!meta) return false;

  const [proposalIds, versionIds] = await Promise.all([
    getKv().smembers(`proposals:${slug}`),
    getKv().smembers(`versions:${slug}`),
  ]);
  await Promise.all([
    ...(proposalIds || []).map(id => getKv().del(`proposal:${slug}:${id}`)),
    ...(versionIds || []).map(v => getKv().del(`version:${slug}:${v}`)),
    getKv().del(`proposals:${slug}`),
    getKv().del(`versions:${slug}`),
    getKv().del(`labels:${slug}`),
    getKv().del(`project:${slug}`),
    getKv().srem('projects', slug),
  ]);
  return true;
}

// --- Versions ---

async function listVersions(slug) {
  const versionIds = await getKv().smembers(`versions:${slug}`);
  if (!versionIds || !versionIds.length) return [];
  const items = await getKv().mget(...versionIds.map(v => `version:${slug}:${v}`));
  return sortVersionsDesc(items.filter(Boolean));
}

async function getVersion(slug, version) {
  return getKv().get(`version:${slug}:${version}`);
}

async function saveVersion(slug, version, content) {
  const existing = await getKv().get(`version:${slug}:${version}`);
  if (!existing) return false;
  await getKv().set(`version:${slug}:${version}`, { ...existing, content, updatedAt: new Date().toISOString() });
  return true;
}

async function createVersion(slug, bumpType, content) {
  const versionIds = await getKv().smembers(`versions:${slug}`);
  const latest = latestFromVersionStrings(versionIds || []) || '1.0.0';
  const newVer = bumpType === 'same' ? latest : bumpVersion(latest, bumpType);
  const data = { version: newVer, createdAt: new Date().toISOString(), content: content || '' };
  await Promise.all([
    getKv().set(`version:${slug}:${newVer}`, data),
    getKv().sadd(`versions:${slug}`, newVer),
  ]);
  await refreshProjectStats(slug);
  return data;
}

// --- Proposals ---

async function listProposals(slug) {
  const ids = await getKv().smembers(`proposals:${slug}`);
  if (!ids || !ids.length) return [];
  const items = await getKv().mget(...ids.map(id => `proposal:${slug}:${id}`));
  return items.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getProposal(slug, id) {
  return getKv().get(`proposal:${slug}:${id}`);
}

async function createProposal(slug, title, description, content, assignee, startDate, dueDate) {
  const id = `prop-${Date.now()}`;
  const proposal = {
    id, title,
    description: description || '',
    content: content || '',
    assignee: assignee || '',
    startDate: startDate || null,
    dueDate: dueDate || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    promotedToVersion: null,
  };
  await Promise.all([
    getKv().set(`proposal:${slug}:${id}`, proposal),
    getKv().sadd(`proposals:${slug}`, id),
  ]);
  await refreshProjectStats(slug);
  return proposal;
}

async function deleteProposal(slug, id) {
  const removed = await getKv().srem(`proposals:${slug}`, id);
  if (!removed) return false;
  await getKv().del(`proposal:${slug}:${id}`);
  await refreshProjectStats(slug);
  return true;
}

async function updateProposal(slug, id, updates) {
  const existing = await getKv().get(`proposal:${slug}:${id}`);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await getKv().set(`proposal:${slug}:${id}`, updated);
  if ('status' in updates) await refreshProjectStats(slug);
  return updated;
}

async function promoteProposal(slug, id, bumpType) {
  const proposal = await getProposal(slug, id);
  if (!proposal) return null;
  // createVersion already calls refreshProjectStats; updateProposal will too
  const newVersion = await createVersion(slug, bumpType, proposal.content);
  await updateProposal(slug, id, { status: 'promoted', promotedToVersion: newVersion.version });
  return newVersion;
}

// --- Labels (project-level, Trello-style colored tags) ---

async function listLabels(slug) {
  return (await getKv().get(`labels:${slug}`)) || [];
}

async function createLabel(slug, name, color) {
  const labels = await listLabels(slug);
  const label = { id: `label-${Date.now()}`, name: (name || 'Label').trim(), color: color || '#3b82f6' };
  labels.push(label);
  await getKv().set(`labels:${slug}`, labels);
  return label;
}

async function updateLabel(slug, id, updates) {
  const labels = await listLabels(slug);
  const idx = labels.findIndex(l => l.id === id);
  if (idx === -1) return null;
  labels[idx] = { ...labels[idx], ...updates };
  await getKv().set(`labels:${slug}`, labels);
  return labels[idx];
}

async function deleteLabel(slug, id) {
  const labels = await listLabels(slug);
  const filtered = labels.filter(l => l.id !== id);
  if (filtered.length === labels.length) return false;
  await getKv().set(`labels:${slug}`, filtered);
  return true;
}

module.exports = {
  listProjects, getProject, createProject, updateProject, deleteProject,
  listVersions, getVersion, saveVersion, createVersion,
  listProposals, getProposal, createProposal, updateProposal, promoteProposal, deleteProposal,
  listLabels, createLabel, updateLabel, deleteLabel,
};
