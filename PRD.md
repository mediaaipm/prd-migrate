# PRD — PRD Manager

**Version:** 2.1.0
**Status:** Describes the system as built (as of 2026-08-22), plus §4.5a — kanban
flow patterns that are specified but not yet built
**Supersedes:** [docs/PRD-v1-graph-vision.md](docs/PRD-v1-graph-vision.md) (archived — described a Git/graph architecture that was never built)

---

## 1. Overview

### 1.1 Summary

PRD Manager is a web tool where a team writes versioned product requirement
documents and runs the task work that comes out of them, in one place.

A **project** holds a stack of semver-tagged markdown **versions** of its PRD.
Anyone can draft a **proposal** — a suggested rewrite — which an admin **promotes**
into a new version. **Tasks** hang off the project (or off a specific version),
nest into sub-tasks, and are worked through a **kanban board**, **tree list**, or
**calendar**, optionally grouped into **sprints**.

### 1.2 Why it exists

The problem it actually solves is the gap between the doc and the work:
requirements live in one system (Notion, Confluence, Google Docs) and the tasks
that implement them live in another (Jira, Linear). The link between "what we
said we'd build" and "what we're building" is maintained by hand, so it rots.

Here, a task belongs to a project — and can belong to a specific *version* of that
project's PRD. Changing the requirements and re-planning the work are the same
motion.

### 1.3 Goals

- Versioned PRDs with a reviewable proposal → promote flow
- Task management (nesting, kanban, sprints, calendar) attached to those PRDs
- Fine-grained permissions so non-admins can move their own work without being
  able to restructure the project
- A full audit trail of who changed what
- Recoverability — snapshots and per-task history, since Redis has no commit log

### 1.4 Non-goals

- Real-time multi-user collaborative editing (last write wins; see §9 R-2)
- Graph visualization / dependency graph / impact analysis (that was v1's vision —
  see the archived doc; it may return as a later phase)
- Git or GitHub as a storage backend
- AI features (summarization, semantic search, duplicate detection)
- SSO / SAML / OAuth
- Native mobile apps

---

## 2. Users & Roles

| Role | Can |
|---|---|
| **superAdmin** | Everything, including **all deletion** (projects, versions, proposals, tasks, snapshots) |
| **admin** | Any subset of the granular permissions below, optionally scoped to specific projects. Cannot delete. |
| **user (viewer)** | Read everything. Update tasks (`task:update` is self-service). Cannot create or delete. |

**Granular permissions** (assignable to admins — [lib/permissions.js](lib/permissions.js)):
`project:create`, `project:update`, `proposal:create`, `proposal:update`,
`proposal:delete`, `proposal:promote`, `task:create`, `task:update`,
`assignee:manage`, `snapshot:manage`, `audit:view`

**Project scoping:** an admin may carry an `assignedProjects` list. If set, they are
gated out of every other project. If unset, they see all projects.

**Task ACL:** a project may restrict what an assignee can do to a task they're on —
`taskAcl.assigneeCanChangeStatus` (bool) and `taskAcl.assigneeStatuses` (whitelist
of statuses they may move a task into). Unset ⇒ permissive.

---

## 3. Architecture

```
Browser (Next.js pages router, React, vanilla CSS)
        ↓  apiFetch — attaches identity header
Next.js API routes (pages/api/*) on Vercel
        ↓  requirePermission / requireSuperAdmin / requireProjectAccess
lib/*-store.js  — the only modules that touch Redis
        ↓
Upstash Redis (REST)          Vercel Cron → /api/cron/* (daily reminders)
```

**Stack:** Next.js 16 (pages router), React 18, vanilla CSS in
[styles/globals.css](styles/globals.css), Upstash Redis, `remark` for markdown,
`diff` for version diffing. No TypeScript. No CSS framework. No ORM.

### 3.1 Redis keys

| Key | Type | Holds |
|---|---|---|
| `projects` | set | all project slugs |
| `project:{slug}` | json | project meta (incl. denormalized `latestVersion`, `pendingProposals`) |
| `versions:{slug}` | set | version strings |
| `version:{slug}:{ver}` | json | `{ version, content, createdAt }` |
| `proposals:{slug}` | set | proposal ids |
| `proposal:{slug}:{id}` | json | proposal |
| `tasks:{slug}:__root` | json | **array** of all project-level tasks |
| `tasks:{slug}:{ver}` | json | **array** of tasks scoped to one version |
| `taskseq:{slug}` | int | atomic counter for task display ids |
| `sprint:{slug}` | json | array of sprints |
| `labels:{slug}` | json | array of labels |
| `user:{name}` | hash | profile: password, role, permissions, assignedProjects |
| `assignees` | set | all user names |
| `notifications:{name}` | json | array, capped at 100 |
| `audit:logs` | zset | capped at 2000 entries |
| `snapshots` / `snapshot:{id}` | set / json | full-system backups |

> **Note the shape:** tasks are stored as **one JSON array per (project, version)**,
> not one key per task. Every task read loads the whole list; every task write
> rewrites it. This is the source of R-1 and R-3 in §9.

---

## 4. Features

### 4.1 Projects
Create with name (→ immutable kebab-case slug), description, status
(`active | on-hold | archived`), priority (`low | medium | high`), members.
A project is born with version `1.0.0` and a scaffolded markdown body.

Admins may set a **task id prefix** (e.g. `ENG` ⇒ `ENG-1`, max 8 uppercase
alphanumeric chars) and a **starting sequence number** (e.g. begin at 1001).

### 4.2 Versions
Semver-tagged markdown. Create by bumping `major` / `minor` / `patch`, or write in
place with `same`. Versions are listed newest-first. Deleting a version also drops
its version-scoped task list and recomputes `latestVersion`.

`/projects/{slug}/diff` renders a textual diff between any two versions.

### 4.3 Proposals
A proposal is a full alternative body for the PRD, with a title, description,
optional assignee, and start/due dates. Status: `pending | promoted | rejected`.

**Promote** (`proposal:promote`) creates a new version from the proposal's content
at the chosen bump level and marks the proposal `promoted`, recording
`promotedToVersion`. The count of pending proposals is denormalized onto the
project so the list view doesn't need an N+1 read.

### 4.4 Tasks
Fields: `id`, `seq`, `title`, `description`, `status`, `priority`, `assignees[]`,
`assignedBy`, `startDate`, `dueDate`, `parentId`, `order`, `boardOrder`,
`numberOverride`, `category`, `labelIds[]`, `attachments[]`, `cover`, `archived`,
`updates[]` (comments), `createdAt`.

- **Two id systems.** `seq` is a project-wide, never-reused integer from an atomic
  `INCR`, rendered as `{prefix}-{seq}`. `number` is a positional outline number
  (`1`, `1.2`, `1.2.1`) recomputed from tree position on every read, overridable
  per task via `numberOverride`.
- **Nesting** is unbounded via `parentId`. Deleting a task cascades to all
  descendants. Moves are cycle-checked.
- **Two orderings**, deliberately separate: `order` (tree position) and `boardOrder`
  (position within a kanban column), so dragging on the board never renumbers the
  outline.
- **Client-generated ids.** The client mints the task id so a queued create can be
  referenced by later queued writes before it reaches Redis, and so a replayed POST
  is a no-op rather than a duplicate ([task-store.js:145](lib/task-store.js#L145)).

### 4.5 Statuses & Kanban
Default columns: `backlog`, `todo`, `in-progress`, `in-review`, `blocked`, `done`.
Columns are **editable by super admins only, and every edit is global**: order,
labels and colors are stored server-side per project (`columns:{slug}`, exposed at
`GET/PUT /api/projects/{slug}/columns`) and every user of the project sees the same
layout. The layout is shared by the main board and every version-scoped board.
Other roles see the board read-only — no drag handle, rename, recolor, add or
delete. `localStorage` still caches the last known layout, but only to avoid a
first-paint flash of the defaults; the server copy always wins.

`columnsWithTaskStatuses()` still synthesizes a column for any unrecognized status
found on a task, so a task parked in a foreign status is never hidden. That
reconciliation is local-only — it does not rewrite the shared layout.

> **R-4 (resolved):** columns previously lived in `localStorage` keyed by apiBase,
> so a custom column one person created was invisible to everyone else.

### 4.5a Kanban flow patterns — planned
The board covers *structure* well (story lanes × category rails, filters, labels,
per-status ACL, checklists, comments, attachments, history). It has no *flow
control*: nothing caps work in progress, nothing surfaces a stuck card, and
nothing models a blocking relation — `blocked` is a status, so a task cannot be
blocked and in-progress at once. The patterns below close that gap, cheapest first.

**Tier 1 — column plumbing only, no task-schema change**

| Pattern | Behaviour | Storage |
|---|---|---|
| WIP limits | Column header shows `3/5`; the column tints over limit and a drop past it warns (soft, never a hard block). Super admin sets it in the existing column editor. | `wip` on the column object in `columns:{slug}` |
| Column collapse | Fold a column to a narrow rail with a count. Six columns × swimlanes is unreadable; Backlog and Done are usually noise. | `localStorage['kanban-cols-collapsed:{slug}']`, same pattern as the lane keys |
| Card density | Compact / normal / cover toggle — biggest readability win per line of code in swimlane mode. | `localStorage['kanban-density:{slug}']` |
| More lane axes | `subLane` is hard-coded `category \| none`; the top axis is hard-coded to story. Add assignee, priority, label and sprint to both by swapping the rail key extractor. | existing `kanban-sublane:{slug}` / `kanban-layout:{slug}` |

**Tier 2 — one new task field**

| Pattern | Behaviour | Storage |
|---|---|---|
| Card aging | Left-edge heat bar: 0–2d none, 3–7d amber, 8d+ red. Shows stuck work without anyone filing a report. | `statusChangedAt`, stamped in `updateTask()` when `status` changes |
| Sprint on the board | `/api/projects/{slug}/sprint.js` exists and the board never calls it. Sprint filter chip, "current sprint only" toggle, sprint as a lane axis. | none — reuses the sprint entity |
| Multi-select + bulk move | Shift-click or marquee, then one drag moves N cards; the context menu acts on the selection instead of one task. | client state only |

**Tier 3 — new relation or new entity**

| Pattern | Behaviour | Storage |
|---|---|---|
| Blocked-by edges | Card shows ⛔ and a blocker count; the chip links to the blocking task; a move to `done` is refused while a blocker is open. A real relation, orthogonal to status. | `task.blockedBy[]` (task ids), enforced in the task PATCH |
| Column policy | Per-column entry criteria text plus an optional required-checklist gate — dragging into `in-review` with unticked items warns. Reuses the existing checklist code. | fields on the column object |
| Flow metrics | Cycle time, throughput per week, aging-WIP scatter. Depends on `statusChangedAt` — build card aging first. | derived |
| Automation rules | On drop into column X: assign to the mover, stamp a done date, tick a checklist item, move the parent when every sub-task lands. | `rules:{slug}`, run client-side on drop and enforced server-side in the task PATCH |

### 4.6 Views
- **Tree** ([TaskTree.js](components/TaskTree.js)) — nested list, inline edit, drag to
  reparent, undo for a drag-move.
- **Kanban** ([KanbanBoard.js](components/KanbanBoard.js)) — drag between and within columns.
- **Calendar** ([CalendarView.js](components/CalendarView.js)) — by start/due date.
- **Dashboard** — per-project and global rollups.

### 4.7 Sprints
`{ id, name, startDate, endDate, taskIds[], status }`, status
`planned | active | completed`. Tasks are hydrated into the sprint on read.

### 4.8 Labels
Project-scoped colored tags `{ id, name, color }`, referenced by `task.labelIds`.

### 4.8a Categories
The second grouping axis, alongside status: a story lane is divided into category
rails (Frontend, Backend, UI/UX…) whose cards then sit in status columns.

A category is a **field on a task**, not a task. `task.category` holds a category
id, so "Backend" is one thing per project rather than one throwaway parent task
under every story — which is what makes "all backend work" a filter instead of an
impossibility, and keeps real sub-tasks two levels deep rather than three.

Storage mirrors board columns exactly: `{ id, name, color }` in `categories:{slug}`,
exposed at `GET/PUT /api/projects/{slug}/categories`, readable by everyone and
writable by super admins only, server-authoritative with `localStorage` as a
first-paint cache ([lib/categories.js](lib/categories.js)). `id` is an immutable
slug and `name` is the renameable display text — the same split as a column's
`status`/`label` — so renaming a category never touches a task.

- **Inheritance.** A task's *effective* category is its own, else the nearest
  ancestor's, else none. Sub-tasks are deliberately left blank rather than stamped
  with the parent's value, so re-categorising a story carries its whole subtree.
  Chips render outlined when inherited, solid when owned.
- **Deletion never cascades.** `categoriesWithTaskValues()` synthesizes a flagged
  entry for any category id still on a task, the same rescue
  `columnsWithTaskStatuses()` performs for a status whose column was removed.
- **Unlike columns, an empty list is valid.** No categories configured means no
  rails and no category UI — the feature stays invisible until it is set up.

### 4.9 Notifications
In-app, per user, capped at 100. Triggered by: assignment to a task, an @mention in
a task comment, a due date being pushed later, and two Vercel crons —
`due-reminders` (08:00 daily: overdue or due-within-24h, with overdue also escalated
to admins) and `delayed-reminders` (12:00 daily).

### 4.10 Audit log
Every mutation writes `{ timestamp, user, action, resource, details, ip }` to a
capped zset. Viewable with `audit:view`. Never allowed to throw into the main path.

### 4.11 Snapshots & Import/Export
Snapshot = full serialization of every project, version, proposal, and task list.
Per-project JSON import/export. **These are the only backup mechanism** — Redis
offers no history, so snapshots stand in for what Git would have given v1.

### 4.12 Task history & sharing
Per-task change history with a viewer modal. Share links deep-link to a task
(`?task={id}`) with clipboard copy.

---

## 5. Security — CURRENT STATE IS BROKEN

> ### 🔴 BLOCKER: authentication is client-asserted.
>
> [lib/api-fetch.js](lib/api-fetch.js) reads the user object out of `localStorage` and
> sends it as an `X-User` header. [lib/require-permission.js](lib/require-permission.js)
> `JSON.parse`s that header and trusts it. There is no signature, no session token,
> no cookie — `/api/auth/login` never issues one.
>
> **Any unauthenticated caller is a superadmin:**
> ```
> curl -X DELETE https://<host>/api/projects/<slug> \
>   -H 'X-User: {"name":"x","role":"superadmin"}'
> ```
> This defeats every permission check, the superadmin-only delete gate, and project
> scoping simultaneously.
>
> Compounding it:
> - Passwords are stored and compared in **plaintext** in the `user:{name}` hash.
> - The built-in superadmin password is **hardcoded in source**
>   ([pages/api/auth/login.js](pages/api/auth/login.js)).
> - The audit log attributes actions to the same forgeable header, so it cannot be
>   trusted as evidence.
>
> **Required before any untrusted user touches this system:**
> 1. Issue a signed, httpOnly session cookie on login (JWT or signed session id).
> 2. Derive the user server-side from that cookie. Delete the `X-User` path entirely.
> 3. Hash passwords (bcrypt/argon2) and migrate existing rows.
> 4. Move the built-in admin credential to an env var; rotate it.
>
> Until then this is safe only on a trusted network with no untrusted users.

Also unresolved: `CRON_SECRET` is optional — if unset, the cron endpoints are open
(low severity; they only send notifications).

---

## 6. Non-functional requirements

| | Target | Today |
|---|---|---|
| Project list load | < 1s | Single `mget`; stats denormalized. OK. |
| Task list load | < 1s at 500 tasks/project | One `get` of the whole array. OK at current scale. |
| Task create | < 300ms | Atomic `INCR` + one array rewrite. |
| Concurrent writers | Must not lose writes | **Fails — see R-1.** |
| Durability | Point-in-time recovery | Snapshots only, manual. |

---

## 7. Data model

**Project** — `{ slug, name, description, status, priority, members[], taskPrefix, taskSeqStart, taskAcl, createdAt, updatedAt, latestVersion, pendingProposals }`
**Version** — `{ version, content, createdAt, updatedAt }`
**Proposal** — `{ id, title, description, content, assignee, startDate, dueDate, status, createdAt, promotedToVersion }`
**Task** — see §4.4
**Sprint** — `{ id, name, startDate, endDate, taskIds[], status, createdAt, updatedAt }`
**Label** — `{ id, name, color }`
**User** — `{ name, username, password, role, permissions[], assignedProjects[] }`

---

## 8. Success metrics

Nothing is instrumented today. Proposed, each with a definition that could actually
be computed from Redis:

| Metric | Definition | Target |
|---|---|---|
| Proposal throughput | promoted proposals ÷ total proposals created, per month | > 60% |
| Doc freshness | median days since `latestVersion.createdAt`, across `active` projects | < 30 days |
| Task-to-PRD linkage | tasks on a version-scoped list ÷ all tasks | > 40% |
| Stale tasks | tasks with `dueDate` in the past and status ≠ `done` | < 10% of open |
| Weekly active users | distinct `user.name` in `audit:logs` in a 7-day window | grows |

---

## 9. Known risks

**R-1 — Lost updates on concurrent task writes. (High)**
Every task mutation is read-modify-write over a single JSON array with no lock or
CAS. Two people editing different tasks in the same project at the same time: the
second write clobbers the first. Fix: per-task Redis keys, or `WATCH`/optimistic
version stamp on the list.

**R-2 — Lost updates on concurrent version edits. (Medium)**
`saveVersion` is last-write-wins on the whole markdown body.

**R-3 — Task list is one key. (Medium)**
Grows unbounded; every read pulls all of it. Fine at hundreds, not at tens of
thousands. Same fix as R-1.

**R-4 — Kanban columns are per-browser.** See §4.5. Fix: move to `project:{slug}`.

**R-5 — No history, no PITR.** Redis is the only copy. Snapshots are manual and
whole-system. Losing the Upstash instance loses everything since the last snapshot.

**R-6 — Auth.** See §5. This is the one that blocks going public.

---

## 10. Roadmap

The previous "Now" list has shipped: real sessions + hashed passwords (§5),
per-task Redis keys (R-1/R-3), server-side kanban columns (R-4).

**Now**
- Kanban WIP limits and column collapse — §4.5a tier 1, no schema change
- Card density toggle and the extra lane axes (assignee / priority / label / sprint)

**Next**
- `statusChangedAt` on tasks, then card aging — §4.5a tier 2
- Sprints on the board (the API exists; the board never calls it)
- Multi-select + bulk task operations
- Scheduled automatic snapshots
- Comments/mentions on proposals, not just tasks
- Saved filters / views

**Later**
- `task.blockedBy[]` dependency edges — §4.5a tier 3, and the surviving good idea
  from the v1 graph vision, minus the Git/Graphify machinery
- Flow metrics: cycle time, throughput, aging WIP (needs card aging first)
- Column policies and drop automation rules
- Task ↔ PRD-section linking (cite the requirement a task implements)
- Impact analysis: "which tasks and projects does changing this requirement touch?"
- Slack notifications
