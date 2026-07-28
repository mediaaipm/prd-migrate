# CLAUDE.md — PRD Manager

## Communication

Caveman mode always on. Short. No fluff. Bullets over paragraphs. No pleasantries.

Bad: "I investigated and identified the root cause."
Good: "Bug in auth middleware. Fix:"

Skip summary at end of response. User reads diff.

---

## Project: PRD Manager

Next.js (pages router) + Upstash Redis. Product requirements & task management tool.

**Stack:**
- Frontend: Next.js, React, vanilla CSS (`styles/globals.css`)
- Backend: Next.js API routes (`pages/api/`)
- Store: Upstash Redis via `lib/prd-store.js`
- Auth: HMAC-signed HttpOnly session cookie (`prd_session`), roles: `viewer` / `admin` / `superAdmin`. Passwords stored as scrypt hashes.

**Key entities:**
- **Project**: `{ slug, name, description, status, priority, members[], createdAt, latestVersion, pendingProposals }`
- **Task**: `{ id, title, status, priority, assignees[], parentId, dueDate, startDate, order, number }`
- **Version**: markdown content per semver tag
- **Proposal**: suggested changes to a version, status: `pending|promoted|rejected`
- **Sprint**: groups tasks, status: `planned|active|completed`
- **Group**: `{ id, name, description, permissions[], assignedProjects[]|null, members[] }` — a bundle of permissions + project visibility granted to every member (union, never subtractive). Superadmin-only.

**Access model (three layers, all enforced server-side):**
1. `role-policy` / `role-policy:{slug}` — the ceiling per role, per project (`/settings/roles`)
2. personal grant on `user:{name}` — `permissions`, `assignedProjects` (Admin → Users → Access)
3. groups the user belongs to — unioned into the personal grant
Effective = (personal ∪ groups, or the whole role policy when nothing is set) ∩ role-policy ceiling.
Visibility perms (`project:view`, `version:view`, `proposal:view`, `task:view`, `sprint:view`, `dashboard:view`, `audit:view`) gate the GET routes; `assignedProjects` decides *which* projects.

---

## Key Files

| Path | Purpose |
|------|---------|
| `lib/prd-store.js` | All Redis CRUD — single source of truth |
| `lib/session.js` | Signed session cookie — **the only** source of request identity |
| `lib/password.js` | scrypt hash/verify (accepts legacy plaintext, flags for re-hash) |
| `lib/login-rate-limit.js` | Per-username + per-IP login throttle |
| `lib/api-fetch.js` | Client-side fetch wrapper (session rides on the cookie) |
| `lib/require-permission.js` | `requirePermission(perm, slug)`, `requireProjectAccess`, `visibleProjects` |
| `lib/require-superadmin.js` | Super-admin gate |
| `lib/permissions.js` | Permission catalogue + labels + role defaults (`PERMS_VERSION`) |
| `lib/role-policy.js` | Per-role, per-project ceiling (`role-policy`, `role-policy:{slug}`) |
| `lib/user-access.js` | Merged personal + group grant for one account (the resolver) |
| `lib/group-store.js` | Group CRUD + membership (`groups`, `group:{id}`, `user-groups:{name}`) |
| `components/PermissionGrid.js` | Shared permission chips + project picker |
| `components/GroupsTab.js` | Admin → Groups: create/edit groups, add members |
| `components/UserAccessEditor.js` | Admin → Users → Access: per-user perms, projects, groups |
| `pages/api/projects/` | REST: projects, versions, tasks, proposals, sprints |
| `pages/index.js` | Project list |
| `pages/projects/[slug]/tasks.js` | Task list + kanban toggle |
| `components/KanbanBoard.js` | Kanban — columns are global per project, superadmin-only edit |
| `lib/kanban-columns.js` | Column layout: server is truth (`columns:{slug}`), localStorage is a first-paint cache |
| `components/TaskTree.js` | Tree list view with inline edit |
| `components/Nav.js` | Top nav |
| `styles/globals.css` | All styles — no CSS modules |

---

## Code Conventions

- API routes: use `requirePermission` or `requireSuperAdmin` before mutations
- Never read identity from a request header. `getSessionUser(req)` from `lib/session.js` is the only entry point
- Never store a password without `hashPassword()`
- Client fetches: always use `apiFetch`, not raw `fetch`
- Redis keys: `project:{slug}`, `task:{slug}:{id}`, `version:{slug}:{ver}`, `sprint:{slug}:{id}`, `group:{id}`, `user-groups:{name}`
- Never read `user:{name}.permissions` directly — go through `getUserAccess()` so groups and the legacy-permission upgrade are applied
- New permissions must be added to `ALL_PERMISSIONS` **and** `PERMISSION_GROUPS`, and `PERMS_VERSION`/`POLICY_VERSION` bumped if omitting them from a stored list would revoke access
- Tasks are flat in Redis; `buildTree()` in TaskTree constructs hierarchy client-side
- Slug = lowercased kebab-case project name (immutable after creation)
- Status values: `backlog | todo | in-progress | in-review | done` (extendable via custom columns)
- Priority values: `low | medium | high`
- Project status: `active | on-hold | archived`
- CSS: add new classes to `globals.css`; no inline styles for layout (use existing utility classes)
- No TypeScript — plain JS throughout

---

## Dev Workflow

```bash
npm run dev     # start dev server
npm run build   # production build
npm run start   # production server
```

Env vars: see `.env.example`. Required — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AUTH_SECRET`, `SUPERADMIN_PASSWORD_HASH`.

```bash
node scripts/set-superadmin.js '<password>'   # prints AUTH_SECRET + password hash
node scripts/hash-passwords.js --dry-run      # migrate plaintext passwords in Redis
```

---

## Graphify Integration

Before task: read Graphify for relevant context (architecture, decisions, prior work).
During task: add discoveries, decisions, arch changes.
After task: sync new knowledge, decisions, status changes, relationships.

Never finish task without Graphify update.

---

## Priority Order

1. Safety (no data loss, no auth bypass)
2. User request
3. Graphify consistency
4. Token minimization
5. Formatting
