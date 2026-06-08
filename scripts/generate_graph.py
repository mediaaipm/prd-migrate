#!/usr/bin/env python3
"""
Generate graph.json from:
  - prds/{slug}/meta.json + versions/*.json + proposals/*.json  (new project structure)
  - prds/*.md with YAML frontmatter                             (legacy flat PRDs)
  - PRD.md (only if it has --- frontmatter)
"""
import os, re, json
from glob import glob

try:
    import yaml
    HAS_YAML = True
except Exception:
    HAS_YAML = False

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PRDS_DIR = os.path.join(ROOT, 'prds')
OUT_DIR = os.path.join(ROOT, 'public', 'graphify')


# ── frontmatter helpers ────────────────────────────────────────────────────────

def parse_frontmatter(text):
    m = re.search(r'^---\s*(.*?)\s*---', text, re.S | re.M)
    if not m:
        return {}
    block = m.group(1)
    if HAS_YAML:
        try:
            return yaml.safe_load(block) or {}
        except Exception:
            pass
    data, key = {}, None
    for line in block.splitlines():
        if not line.strip():
            continue
        if ':' in line and not line.strip().startswith('-'):
            k, v = line.split(':', 1)
            key = k.strip()
            data[key] = [] if v.strip() == '' else v.strip()
        elif line.strip().startswith('-') and key:
            existing = data.get(key)
            if existing is None:
                data[key] = []
            elif isinstance(existing, str):
                data[key] = [existing]
            data[key].append(line.strip().lstrip('-').strip())
    return data


# ── new project structure ─────────────────────────────────────────────────────

def load_projects():
    nodes, edges = {}, []
    if not os.path.isdir(PRDS_DIR):
        return nodes, edges

    for slug in os.listdir(PRDS_DIR):
        meta_path = os.path.join(PRDS_DIR, slug, 'meta.json')
        if not os.path.isfile(meta_path):
            continue
        try:
            meta = json.loads(open(meta_path, encoding='utf-8').read())
        except Exception:
            continue

        proj_id = f"proj:{slug}"
        nodes[proj_id] = {
            'id': proj_id,
            'label': meta.get('name', slug),
            'type': 'project',
            'meta': {
                'slug': slug,
                'description': meta.get('description', ''),
                'createdAt': meta.get('createdAt', ''),
            }
        }

        # versions
        ver_dir = os.path.join(PRDS_DIR, slug, 'versions')
        if os.path.isdir(ver_dir):
            for vf in sorted(glob(os.path.join(ver_dir, '*.json')), reverse=True):
                try:
                    v = json.loads(open(vf, encoding='utf-8').read())
                except Exception:
                    continue
                ver = v.get('version', os.path.splitext(os.path.basename(vf))[0])
                ver_id = f"ver:{slug}:{ver}"
                nodes[ver_id] = {
                    'id': ver_id,
                    'label': f"v{ver}",
                    'type': 'version',
                    'meta': {
                        'project': slug,
                        'version': ver,
                        'createdAt': v.get('createdAt', ''),
                        'updatedAt': v.get('updatedAt', ''),
                    }
                }
                edges.append({'from': proj_id, 'to': ver_id, 'type': 'has_version'})

        # proposals
        prop_dir = os.path.join(PRDS_DIR, slug, 'proposals')
        if os.path.isdir(prop_dir):
            for pf in glob(os.path.join(prop_dir, '*.json')):
                try:
                    p = json.loads(open(pf, encoding='utf-8').read())
                except Exception:
                    continue
                pid = p.get('id', os.path.splitext(os.path.basename(pf))[0])
                prop_id = f"prop:{slug}:{pid}"
                nodes[prop_id] = {
                    'id': prop_id,
                    'label': p.get('title', pid),
                    'type': f"proposal:{p.get('status', 'pending')}",
                    'meta': {
                        'project': slug,
                        'status': p.get('status', 'pending'),
                        'description': p.get('description', ''),
                        'createdAt': p.get('createdAt', ''),
                        'promotedToVersion': p.get('promotedToVersion'),
                    }
                }
                edges.append({'from': proj_id, 'to': prop_id, 'type': 'has_proposal'})
                if p.get('promotedToVersion'):
                    promoted_ver_id = f"ver:{slug}:{p['promotedToVersion']}"
                    if promoted_ver_id in nodes:
                        edges.append({'from': prop_id, 'to': promoted_ver_id, 'type': 'promoted_to'})

    return nodes, edges


# ── legacy flat PRD .md files ─────────────────────────────────────────────────

def load_legacy_prds():
    nodes, edges = {}, []
    candidates = []

    top = os.path.join(ROOT, 'PRD.md')
    if os.path.isfile(top):
        if open(top, encoding='utf-8').read(8).lstrip().startswith('---'):
            candidates.append(top)

    if os.path.isdir(PRDS_DIR):
        for ext in ('*.md', '*.markdown'):
            candidates.extend(glob(os.path.join(PRDS_DIR, ext)))

    for path in candidates:
        try:
            text = open(path, encoding='utf-8').read()
            fm = parse_frontmatter(text)
            pid = fm.get('id') or os.path.splitext(os.path.basename(path))[0]
            title = fm.get('title') or (re.search(r'^#\s*(.+)$', text, re.M) or ['', pid])[1].strip() if re.search(r'^#\s*(.+)$', text, re.M) else pid
            depends = fm.get('depends_on', [])
            if isinstance(depends, str):
                depends = [d.strip() for d in re.split(r'\s*-\s*', depends) if d.strip()]
            nodes[pid] = {
                'id': pid,
                'label': title,
                'type': 'prd',
                'meta': {
                    'version': fm.get('version', ''),
                    'owner': fm.get('owner', ''),
                    'status': fm.get('status', ''),
                    'path': os.path.relpath(path, ROOT),
                }
            }
            for dep in depends:
                edges.append({'from': pid, 'to': dep, 'type': 'depends_on'})
        except Exception as e:
            print('Skipping', path, e)

    # ensure dependency stubs exist
    all_ids = set(nodes)
    for e in edges:
        if e['to'] not in all_ids:
            nodes[e['to']] = {'id': e['to'], 'label': e['to'], 'type': 'prd', 'meta': {}}
            all_ids.add(e['to'])

    return nodes, edges


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    proj_nodes, proj_edges = load_projects()
    prd_nodes, prd_edges = load_legacy_prds()

    all_nodes = {**prd_nodes, **proj_nodes}
    all_edges = prd_edges + proj_edges

    graph = {
        'nodes': list(all_nodes.values()),
        'edges': all_edges,
        'meta': {
            'projects': sum(1 for n in all_nodes.values() if n['type'] == 'project'),
            'versions': sum(1 for n in all_nodes.values() if n['type'] == 'version'),
            'proposals': sum(1 for n in all_nodes.values() if n['type'].startswith('proposal')),
            'prds': sum(1 for n in all_nodes.values() if n['type'] == 'prd'),
        }
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, 'graph.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2)

    # also keep graphify/ dir in sync
    mirror_dir = os.path.join(ROOT, 'graphify')
    os.makedirs(mirror_dir, exist_ok=True)
    with open(os.path.join(mirror_dir, 'graph.json'), 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2)

    m = graph['meta']
    print(f"Graph written -> {out_path}")
    print(f"  {m['projects']} projects  {m['versions']} versions  {m['proposals']} proposals  {m['prds']} legacy PRDs")
    print(f"  {len(all_edges)} edges total")


if __name__ == '__main__':
    main()
