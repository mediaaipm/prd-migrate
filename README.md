# PRD Manager

A tool where a team writes versioned product requirement documents and runs the task
work that comes out of them, in one place.

A **project** holds a stack of semver-tagged markdown **versions** of its PRD. Anyone
can draft a **proposal** — a suggested rewrite — which an admin **promotes** into a new
version. **Stories** (root tasks) and their **sub-tasks** hang off the project (or off a
specific version) and are worked through a **kanban board**, **tree list** or
**calendar**. Stories are planned into **sprints** that run on a cadence, grouped under
**epics**, checked on a **QA board**, and measured on **Insights**, **Teams** and
per-person **performance** pages.

Next.js 16 (App Router) · React 18 · Upstash Redis · plain JS (no TypeScript) · vanilla
CSS plus a few shadcn/ui components.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Concepts](#concepts)
- [Features](#features)
- [Access Control](#access-control)
- [Teams & performance](#teams--performance)
- [Sprints — Full Guide](#sprints--full-guide)
- [Storage: keys, attachments, and retention](#storage-keys-attachments-and-retention)
- [API Reference](#api-reference)
- [Scripts](#scripts)
- [Graphify (code knowledge graph)](#graphify-code-knowledge-graph)
- [Tech Stack](#tech-stack)
- [Deploying](#deploying)
- [Docs Map](#docs-map)

---

## Getting Started

### Prerequisites

- Node.js **20+** (see `.nvmrc`)
- An [Upstash Redis](https://upstash.com/) database (REST API)

### Install

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env.local`. Required:

| Var | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST token |
| `AUTH_SECRET` | Signs the `prd_session` cookie. Min 16 chars, 32 random bytes recommended. Changing it invalidates every active session. |
| `SUPERADMIN_PASSWORD_HASH` | Break-glass superadmin. Without it (or dev-only `SUPERADMIN_PASSWORD`) the built-in account does not exist and you can only sign in with accounts stored in Redis. |

Optional:

| Var | Purpose |
|---|---|
| `SUPERADMIN_USERNAME` | Defaults to `admin` |
| `CRON_SECRET` | Bearer token the cron routes require. Without it the sprint-rollover cron refuses every call |
| `SPRINT_TZ` | Time zone that decides when a sprint day starts and ends. Defaults to `Asia/Kolkata` |
| `ALLOW_HEADER_AUTH=1` | Dev only — accept the legacy `X-User` header instead of a session cookie. Ignored when `NODE_ENV=production`. |
| `CPU_LOG=1` | Log per-route CPU to the function logs (Vercel Fluid Active CPU diagnosis). Off unless set to exactly `1`; when off the instrumentation is not wired up at all. |

Generate the auth secret and superadmin hash together:

```bash
node scripts/set-superadmin.js '<password>'
```

### Run

```bash
npm run dev     # http://localhost:3000
npm run build
npm run start
```

---

## Concepts

The shape of the thing:

```
Project
│
└── PRD Version
    │
    ├── User Story                 ← a root-level task; the lane on the swimlane board
    │   ├── Acceptance Criteria    ← a field on the story, not a task
    │   └── Tasks                  ← sub-tasks, unbounded nesting
    │       └── Sub-tasks
    │
    └── Standalone Tasks           ← root tasks with no story framing
```

There is no separate story entity. A **story is a root-level task** — the thing the
swimlane board draws as a lane rather than a card — and its **acceptance criteria** are
a field on it. That keeps one hierarchy (`parentId`) instead of two, so a standalone
task and a story are the same record with different framing.

| Entity | Redis key | Notes |
|---|---|---|
| **Project** | `project:{slug}` | Slug is lowercased kebab-case of the name, immutable after creation. Status `active \| on-hold \| archived`. |
| **Version** | `version:{slug}:{ver}` | Markdown PRD content, one per semver tag. |
| **Proposal** | `proposal:{slug}:{id}` | Suggested rewrite of a version. Status `pending \| promoted \| rejected`. |
| **Task** | inside `tasks:{slug}:{version\|__root}` | Flat in Redis; `buildTree()` reconstructs hierarchy client-side from `parentId`/`order`. |
| **Sprint** | `sprint:{slug}:{id}` + `sprints:{slug}` (index) | Plans **stories**. Status `planned \| active \| completed`; one active per project, a story in at most one open sprint. Cadence in `sprint-config:{slug}`. |
| **Epic** | `epic:{slug}:{id}` + `epics:{slug}` | Groups stories across versions. Epic › story › sub-task. |
| **Label** | `labels:{slug}` | Mandatory on task creation once a project has any. |
| **Category** | `categories:{slug}` | The board's second axis. A *field* on a task, not a task. |
| **Column** | `columns:{slug}` | The project's status set. Global per project, superadmin-only edit. |
| **Group** | `group:{id}` | A named bundle of permissions + project visibility. Superadmin-only. |
| **User** | `user:{name}` (hash) + `assignees` (set) | `role`, `lead` (who they report to), credentials, personal grant. |

**Task record** — `id`, `seq`, `title`, `description`, `status`, `priority`
(`low | medium | high | critical`), `assignees[]`, `assignedBy`, `startDate`,
`dueDate`, `parentId`, `order`, `boardOrder`, `number`/`numberOverride`, `category`,
`labelIds[]`, `attachments[]`, `cover`, `points`, `checklist[]`, `acceptance[]`,
`updates[]`, `completedAt`, `archived`, `createdAt`. Stories only: `userStory`
(`{ role, goal, benefit }`), `epicId`, `qa` (server-owned QA state and history),
`carryOver` (times rolled into a later sprint).

Redis has no schema: a field appears on a record the first time it is written, and
readers treat a missing field as its default (no role = Dev, no `lead` = not on a team,
no `acceptance` = none). New fields need no migration.

`task.category` holds a category **id**, never a name, and is read through
`effectiveCategory()` so ancestor inheritance applies.

`task.acceptance` is the story's acceptance criteria — see
[the Tasks feature list](#tasks) and `lib/task-acceptance.js`.

---

## Features

### Projects

The home page lists every project you can see, with its latest version, pending
proposal count and a link to its tasks. Projects carry members, priority, status and
an optional per-project task ACL.

### PRD versions & proposals

- Rich markdown editor (`/editor`) per version
- Version bumps: patch / minor / major
- Proposals — draft changes reviewed and promoted into a new version
- Side-by-side diff viewer (`/projects/{slug}/diff`) between any two versions or proposals

### Tasks

- **Stories and sub-tasks** — a story is a root task; sub-tasks nest under it without
  limit, auto-numbered (`1`, `1.1`, `1.2.3`). Only stories are cards that move between
  board columns; sub-tasks are rows under their story
- **Story statuses** — the project's column set. Defaults: Backlog, To Do, In Progress,
  Rework (`need-rework`), QA Review (`in-review`), Blocked, Done. A new story starts in
  Backlog; planning it into a sprint moves it to To Do
- **Sub-task statuses** — Not started / In progress / Done only (`lib/subtask-status.js`).
  A sub-task still on an old board status shows it with "(old)" until changed. Moving a
  story to Done closes its open sub-tasks
- **Who adds what** — Devs and QA add sub-tasks only; team leads, managers and admins
  also add stories (`MIN_ADMIN_DEPTH`, enforced on the server)
- **User story** — "As a… I want… so that…" on a story (`lib/user-story.js`)
- **Priority** — Low, Medium, High, Critical
- **Assignees, dates, story points** — points are Fibonacci (1, 2, 3, 5, 8, 13, 21);
  blank means not estimated
- **Labels** — mandatory on create once a project has labels configured (enforced server-side, so import and scripts cannot skip it)
- **Categories** — the second grouping axis, independent of status
- **Checklists** — up to 50 items × 500 chars. Editable by anyone who can open the card
- **Acceptance criteria** — up to 30 per story: the conditions that decide whether a
  story is actually done. Written by a task editor, ticked by whoever verifies (the
  two are rarely the same person). Moving a task with unmet criteria into Done warns
  rather than blocks
- **Attachments & cover images** — 1 MB per file, 20 per task, served from their own cacheable route
- **@mentions** in updates, which notify the named user
- **Per-task history** — a timestamped activity log, capped at 500 entries
- **Share links** — copy an absolute URL that deep-links to a single card
- **Import / export** — CSV or JSON, per project and optionally per version

### Views

| View | What it is |
|---|---|
| **List** | Tree with inline edit, drag to reorder and re-nest |
| **Kanban** | Drag-and-drop board. Two layouts: plain **columns**, or **swimlanes** (story lane › category rail › status column) |
| **Calendar** | Month grid; drag a card to reschedule its due date |

All three share a filter sidebar (assignee, label, category, priority, status) and a
task context menu.

### Sprints & analytics

Per project, at `/projects/{slug}/sprints`: plan stories into sprints that open, close
and roll over on the project's cadence, run the current sprint on its own board, and read
the metrics — burndown against the ideal line, velocity
across completed sprints, per-person throughput, capacity vs. delivered, scope change
against the baseline stamped when the sprint went active, and forecast. Working-day
maths honours the org-wide holiday calendar and weekend configuration.

See the [full guide](#sprints--full-guide).

### Epics & backlog

**Epics** (`/projects/{slug}/epics`) group stories across versions, with progress, owner
and target date. Create/edit needs `project:update`; deleting an epic (superadmin)
unlinks its stories, never deletes them. **Backlog** (`/projects/{slug}/backlog`) lists
the stories still in Backlog, grouped by epic.

### QA review

The **QA Review** tab (`/projects/{slug}/qa`) has three lists: *Waiting for QA*, *Sent
back*, *Passed* (last 14 days).

- A story moved to **QA Review** enters the queue and QA accounts are notified.
- **Pass** moves it to Done (its open sub-tasks close with it; unmet acceptance criteria
  ask first). **Send back** needs a note, moves it to **Rework** in the current sprint,
  posts the note as a comment and notifies the people on it.
- Verdicts need `qa:review` (QA, team lead, manager, admin by default) and go only through
  `POST /api/projects/{slug}/qa`. A QA assigned to a story cannot pass it.
- **Open card** opens the story in place: user story, description, acceptance criteria
  (tickable), sub-tasks, attachments, comments and QA history, with the verdict buttons.

### My tasks

`/my-tasks` — everything assigned to you across the projects you can see, grouped
Overdue / Due today / Next 7 days / Later / No due date, plus Done (last 30 days).
**My team** (shown when people report to you) lists your team's tasks per person.

### Holidays & the working week

Global, not per project (Admin → Holidays). Holidays are seeded per year on first read
and can be edited or cleared — a year emptied by hand stays empty, because a
`holidays-seeded:{year}` marker records that seeding already happened. The weekend
configuration (`weekendDays`, `country`) is superadmin-only and feeds every working-day
calculation in sprint analytics.

### Insights

**Per-project** (`/projects/{slug}/dashboard`, the **Insights** tab), built around
stories: stories done, the story pipeline by board column, the current sprint (work done
vs time used, points vs capacity, carried-in stories, unowned work), a "Needs attention"
list (overdue, due in 7 days, stories carried over twice or more — each row opens the
task), open epics with progress and target date, workload per person (open + late), and
sprint history with velocity from the frozen sprint summaries. Sprint cards need
`sprint:view`, epics need `task:view`. There is no cross-project dashboard.

### Notifications & reminders

An in-app bell fed by `notifications:{name}` (capped at 100 per user): @mentions, QA
hand-overs and verdicts, sprint events, and the reminder crons:

| Route | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/due-reminders` | `0 8 * * *` | Notifies assignees of tasks overdue or due within 24h |
| `/api/cron/delayed-reminders` | `0 12 * * *` | Re-notifies assignees of still-open tasks whose due date was pushed back |
| `/api/cron/sprint-rollover` | `35 18 * * *` | Closes ended sprints (carrying unfinished stories) and starts due ones, for projects nobody opened that day |

All authenticate with `CRON_SECRET`. The reminder crons read via `loadTasks` rather than
`listTasks` (no numbering pass, no write-on-read seq backfill) because they touch every
task in every project.

### Admin panel

`/admin`, tabbed:

- **Users** — one row per person: role (Manager, Team lead, Design lead, Dev, Designer, QA — only admins make
  Managers; a super admin can pick any role, Admin and Super admin included, for anyone
  but themselves) and **Reports to**. Sign-in, projects & permissions, rename and remove are in
  the row's ⋯ menu. Filter by role or *Can't sign in*. Each tab has its own URL
  (`/admin?tab=audit`)
- **Admins** — superadmin only
- **Groups** — superadmin only; permission + project bundles with membership
- **Holidays** — requires `holiday:manage`
- **Snapshots** — point-in-time copies of every project, version, proposal and task
- **Audit log** — timestamped history of every mutation, capped at 2000 entries

`/settings/roles` holds the role policy — the per-role, per-project ceiling.

### Themes

Ten themes — light: Light, Morning, Sunrise, Light Neon; dark: Dark, Evening, Sunset,
Chocolate, Dark Neon, Blackhole — picked from the 🎨 menu in the top bar, or **Match
system** to follow the OS. Every theme passes WCAG AA contrast for text, muted text,
accent and status chips; re-check when adding one. The list lives in
`lib/theme-registry.js`, tokens per theme in `globals.css` (`html[data-theme=…]`). `<html>` carries `data-theme` (the exact id)
and `data-mode` (`light`/`dark`, the family it inherits tokens from). An inline script in
`app/layout.js` stamps both before first paint, so there is no flash. The choice
lives in `localStorage['ss_theme']` and never touches the session or Redis.

---

## Access Control

Identity is an HMAC-signed, HttpOnly `prd_session` cookie; sessions last 12h. On every
API request `lib/session-live.js` re-checks it against `user:{name}`: the role is read
live, and deleting an account or changing its password revokes its sessions.
Passwords are scrypt hashes. Login is throttled per username **and** per client IP in a
fixed 15-minute window.

Three layers, all enforced server-side:

1. **Role policy** — `role-policy` (global) / `role-policy:{slug}` (per-project override).
   The ceiling per role bucket (`admin`, `manager`, `teamlead`, `user` = Dev, `qa`), plus the
   status blocklist. Pick a bucket with `ceilingFor(policy, role)`.
2. **Personal grant** on `user:{name}` — `permissions`, `assignedProjects`.
3. **Groups** the user belongs to — unioned into the personal grant.

```
effective = (personal ∪ groups, or the whole role policy when nothing is set)
            ∩ role-policy ceiling
```

Never read `user:{name}.permissions` directly — go through `getUserAccess()` so groups
and the legacy-permission upgrade are applied.

### Roles

Stored on `user:{name}.role` (`lib/roles.js`); a missing role reads as Dev.

| Role | Can |
|---|---|
| **Super admin** | Everything, including all deletion (projects, versions, proposals, tasks, snapshots) and every config surface (columns, categories, groups, role policy, working week) |
| **Admin** | Any subset of the granular permissions, optionally scoped to projects. Manages users and roles; sees every team and everyone's performance. Cannot delete. |
| **Manager** | Lead powers (add stories, plan sprints, epics, QA verdicts, gated statuses); sees every team and everyone's performance; manages team members |
| **Team lead** | Lead powers; sees their own team's tasks and performance |
| **Design lead** | A Team lead for design: same powers and defaults, its own policy bucket (`designlead`) |
| **Dev** | Works tasks, adds sub-tasks, moves stories through non-gated statuses; sees their own performance |
| **QA** | As Dev, plus Pass / Send back on the QA board |
| **Designer** | As Dev, for design work: own policy bucket (`designer`), starts with the Dev defaults |

Role changes go through `PUT /api/assignees/{name} { role }`. Never your own; Manager only
by an admin. A super admin may set any role on anyone, admins included; everyone else
sets team roles on team members only. Moving someone across the admin / team-member line
clears their personal permission list, so the new role's policy applies (project access
and groups stay). New admins can also be created under Admin → Admins.

### Permissions

**Visibility** — gate the GET routes: `project:view`, `version:view`, `proposal:view`,
`task:view`, `sprint:view`, `dashboard:view`, `audit:view`

**Actions** — `project:create`, `project:update`, `proposal:create`, `proposal:update`,
`proposal:delete`, `proposal:promote`, `task:create`, `task:update`, `qa:review`,
`assignee:manage`, `holiday:manage`, `snapshot:manage`

`holiday:manage` is global, not project-scoped — the holiday calendar is org-wide.

**Project scoping:** `assignedProjects` decides *which* projects a visibility permission
applies to. Unset means all.

**Task ACL:** a project may restrict what an assignee can do to a task they are on —
`taskAcl.assigneeCanChangeStatus` and `taskAcl.assigneeStatuses`. Unset ⇒ permissive.
Separately, `userRestrictedStatuses` on the role policy names statuses a plain user may
never move a task into (default: in-review, need-rework, done, backlog, blocked).

**Acceptance criteria** carry their own split, enforced structurally rather than by
permission: authoring one (add, reword, remove) needs `task:update`; ticking one needs
only card access. A patch from an account without `task:update` is accepted only when
the items, their wording and their order are unchanged — so a viewer can sign a
criterion off but cannot reword the contract they are signing.

Adding a permission means adding it to `ALL_PERMISSIONS` **and** `PERMISSION_GROUPS`,
and bumping `PERMS_VERSION` / `POLICY_VERSION` if omitting it from a stored list would
silently revoke access.

---

## Teams & performance

**Teams** come from one field: `user:{name}.lead`, the person's team lead (Admin → Users
→ *Reports to*, `PUT /api/assignees/{name} { lead }`, needs `assignee:manage`).

- The lead must sit above the person: **Dev / QA / Designer → Team lead or Design lead → Manager** (a Manager may
  report to another Manager). `canLead()` in `lib/roles.js`, `leadError()` in
  `lib/team.js`; loops are refused. Changing someone's role, or making them an admin,
  clears links that no longer fit (`brokenLinks()`). Deleting a lead clears their
  people's `lead`; renaming carries over.
- A team is a lead plus their direct reports; a lead's tree includes people under leads
  who report to them.

**Who sees what** (server-side; numbers only ever come from projects the *viewer* can
open):

| | Teams page, My team | Person pages |
|---|---|---|
| Admin, super admin, manager | every team (`seesAllTeams()`) | everyone |
| Team lead | their team and leads under them | the people under them |
| Dev, QA | — | their own |

**Teams** (`/teams`): an overview comparing teams, and per team — open/overdue, done
in 30 days, QA first pass, throughput, open work by status, workload per person, *Team
performance* (on time, typical time to finish, sent back by QA, carry-over, blocked) and
a sortable *Member performance* table.

**Person pages** (`/people/{name}`): one person's open and overdue work, done in 30 days,
on-time rate, 12-week throughput, QA first pass, times sent back, typical time to
finish, carry-over, comments, QA reviews given, a per-project breakdown and their
open/done tasks. Every person name or avatar in the app renders through
`components/PersonLink.js` and links here when the viewer may open it; *My performance*
is in the account menu. Stats for both pages come from `lib/person-stats.js`.

---

## Sprints — Full Guide

### What a sprint is

A short work cycle in one project. A sprint plans **stories** (`storyIds`); their
sub-tasks ride along, so a sub-task added mid-sprint is in the sprint without
re-planning (`taskIds` is that derived expansion). One sprint is active per project, and a
story is in at most one open (planned or active) sprint.

The Sprints page (`/projects/{slug}/sprints`) has four tabs: **Current**, **Plan**, **All
sprints**, **Metrics**.

### Lifecycle and cadence

`planned → active → completed`. Completing a sprint **freezes** its result (`frozen`,
`summary`) and carries every unfinished story into the next sprint (`task.carryOver` +1),
creating that sprint on the cadence if none is planned. Metrics for a closed sprint must
read `sprintTasks()` (the frozen view), never live task status.

Cadence lives in `sprint-config:{slug}` (Sprints → **Cadence**) and is applied by
`applyCadence()` on every sprint GET and by the daily `/api/cron/sprint-rollover`:

| Setting | Default |
|---|---|
| Length, start → end day | 2 weeks, Monday → Friday |
| `autoRollover` | on — closes at the end of the last day, unfinished stories carried |
| `autoStart` | on — the next sprint starts itself on its start day |
| `alwaysCreateNext` | on — a next sprint is opened even when nothing carries over |
| `earlyComplete` | off — manual *Complete sprint* only from the last day (enforced in `completeSprintLocked`) |

Sprint writes need `project:update`; deleting a completed sprint needs superadmin.

**Storage migration.** Older data kept all of a project's sprints in one array at
`sprint:{slug}`. The first sprint read for a project splits it into per-sprint keys and
sets `sprints-migrated:{slug}`. The old array is never written or deleted, so code from
before the split still reads it if you roll back (changes made after the split are not in
it).

### Analytics

The **Metrics** tab:

- **Burndown** — remaining work per day against the ideal line, in points when the
  sprint uses them and weighted items when it does not. Every calendar day in the
  window, hard-capped at 400 rows so a mistyped end date cannot spin a request into an
  out-of-memory.
- **Velocity** — per-sprint delivery across completed sprints, plus average, median,
  last sprint and forecast.
- **Team** — per-person throughput, sortable.

Headline tiles: completion, points, working days, needed per day, scope change, overdue,
blocked, unassigned.

All the maths lives in `lib/sprint-metrics.js` as pure functions — nothing in that file
touches Redis, so holidays, the weekend config and "today" are all passed in and the
whole module can be exercised without a database, a session or a clock. Date arithmetic
runs on `YYYY-MM-DD` strings anchored at UTC midnight, stepping a UTC millisecond
counter, because `new Date(y, m, d + 1)` falls into the DST hole twice a year and a
sprint that silently loses or repeats a day is a burndown that never reconciles.

Holiday lookups are individually guarded: a broken or missing holiday module degrades
the numbers to weekends-only rather than 500-ing the dashboard.

---

## Storage: keys, attachments, and retention

Everything lives in one Upstash Redis store. There is no blob storage.

### Key families

| Key | Contents | Bounded by | Cleaned up by |
|---|---|---|---|
| `projects` | set of project slugs | — | project delete |
| `project:{slug}` | project metadata | — | project delete |
| `versions:{slug}`, `version:{slug}:{ver}` | version index, markdown | — | version delete |
| `proposals:{slug}`, `proposal:{slug}:{id}` | proposals | — | proposal delete |
| `tasks:{slug}:{version\|__root}` | the whole task list for one version, **metadata only** | task count, not image count | task delete |
| `taskatt:{slug}:{version}:{taskId}:{attId}` | one attachment's bytes | 1 MB/file, 20/task | task delete |
| `taskseq:{slug}` | monotonic task sequence counter | — | project delete |
| `taskhistory:{slug}:{ver}:{taskId}` | per-task activity | 500 entries (`ltrim`) | **nothing — see below** |
| `sprint:{slug}:{id}`, `sprints:{slug}` | one sprint per key + index set | — | sprint delete |
| `sprint-config:{slug}` | sprint cadence | — | manual |
| `sprints-migrated:{slug}` | marks the one-time split of the legacy array | — | — |
| `sprint:{slug}` | **legacy** array of sprints, read once by the migration | — | never (kept as a backup) |
| `epic:{slug}:{id}`, `epics:{slug}` | epics + index set | — | epic delete |
| `columns:{slug}`, `categories:{slug}`, `labels:{slug}` | board config | — | project delete |
| `holidays:{year}`, `holidays-seeded:{year}`, `holiday-config` | org calendar + working week | — | manual |
| `user:{name}`, `assignees` | accounts: role, `lead`, credentials, grant | — | user delete |
| `groups`, `group:{id}`, `user-groups:{name}` | access bundles | — | group delete |
| `role-policy`, `role-policy:{slug}` | the per-role ceiling | — | manual |
| `notifications:{name}` | per-user feed | 100 entries | user delete |
| `audit:logs` | global audit trail | 2000 entries (`zremrangebyrank`) | automatic |
| `snapshots`, `snapshot:{id}` | full serialization of every project, version, proposal and task | 10 snapshots (`pruneSnapshots`) | automatic, on create |
| `loginfail:user:*`, `loginfail:ip:*` | rate-limit counters | 15 min TTL | automatic |
| `lock:tasks:{slug}:{version}` | write lock on a task list | TTL | automatic |

### Attachments

Uploads are capped at **1 MB per file and 20 per task**, enforced in the form *and*
server-side in the task create/update routes. Nothing resizes or recompresses them, so
the cap is the only limit on what a task can carry.

Attachment bytes live in **their own keys**, one per attachment, and never appear on a
list response. Task lists, reorder responses and sprint payloads carry metadata plus a
`url` pointing at `/api/projects/{slug}/media/{taskId}/{attId}`, which serves the bytes
with an ETag and a one-year immutable cache.

That shape exists because of two separate failures:

1. **Transfer.** Inline base64 meant every board load and every drag-reorder re-sent
   every image, uncacheable, straight out of a function — which is what exhausted the
   Vercel Fast Origin Transfer quota.
2. **Storage.** A project's tasks live in ONE Redis value, so inlined images accumulated
   inside it until the list hit Upstash's 10 MB max request size and every subsequent
   write — every task create — died with a 500.

Three invariants keep it working. Break any of them and you either reintroduce the
transfer cost or lose data:

1. Every route returning task objects passes them through `stripTaskMedia` /
   `stripTasksMedia` (`lib/task-media.js`).
2. Every route accepting task objects back passes them through `mergeTaskMedia`, which
   restores the bytes the client could not send. Without it, saving a task edited from a
   stripped list response overwrites the attachment with its stripped twin.
3. Covers store `{ attId }` only — a reference to an attachment already on the task,
   never a second copy of the bytes. `lib/attachment-src.js` (`attSrc` / `coverSrc`)
   resolves either form for rendering, including newly-picked files that only exist
   locally.

### Config endpoint caching

Columns, categories and labels are re-fetched on every board mount and almost never
change, which made them a large share of the app's function invocations for data the
browser already had. They now answer `private, max-age=…` (`sendJsonConfig` in
`lib/etag.js`), and a revision token in the URL (`lib/config-cache.js`, held in
localStorage) is bumped after a write — so the one client that must never see staleness,
the one that just made the edit, misses its own cache entry instead of reloading its
pre-edit copy over the fresh value. Everyone else sees up to the max-age of staleness,
which is the trade being made on purpose: these endpoints carry labels and colours, not
task state.

### Known gaps

- **`deleteTaskHistory` is never called.** Deleting a task leaves its `taskhistory:*` key
  behind. Each is capped at 500 entries, so the waste is bounded per key but unbounded in
  key count.
- **Snapshots embed everything.** They are capped at 10 and pruned on create, and
  attachment bytes no longer live inside the task records they embed — but N snapshots is
  still N copies of every project. Per the PRD, Redis is the only copy and snapshots
  stand in for point-in-time recovery.

### Inventory

```bash
node scripts/store-report.js               # totals by key prefix
node scripts/store-report.js --top 30      # largest individual keys
node scripts/store-report.js --json s.json # snapshot the numbers to diff later
```

Read-only — it writes and deletes nothing. Run it before and after any cleanup, and
periodically to catch growth early.

---

## API Reference

All handlers live under `server/api/` and are served by generated App Router routes (`app/api/**/route.js`, via `lib/route-adapter.js`; regenerate with `node scripts/gen-app-routes.js`). Mutations go through `requirePermission` or
`requireSuperAdmin`; identity comes only from `getSessionUser(req)`. Client code always
calls through `apiFetch`, never raw `fetch`.

### Auth

| Route | Methods |
|---|---|
| `/api/auth/login` | POST |
| `/api/auth/logout` | POST |
| `/api/auth/me` | GET |

### Projects

| Route | Methods |
|---|---|
| `/api/projects` | GET, POST |
| `/api/projects/{slug}` | GET, PUT, DELETE |
| `/api/projects/{slug}/access` | GET, PUT |
| `/api/projects/{slug}/columns` | GET, PUT |
| `/api/projects/{slug}/categories` | GET, PUT |
| `/api/projects/{slug}/labels` | GET, POST, PUT, DELETE |
| `/api/projects/{slug}/diff` | GET |
| `/api/projects/{slug}/export` | GET (`?format=json\|csv`, `?version=`, `?media=`) |
| `/api/projects/{slug}/import` | POST |
| `/api/projects/{slug}/dashboard` | GET |
| `/api/projects/{slug}/sprint` | GET, POST, PUT, PATCH (`?id=`, `{ action: start \| complete \| addStories \| removeStories }`), DELETE |
| `/api/projects/{slug}/sprint-config` | GET, PUT |
| `/api/projects/{slug}/sprint-analytics` | GET (`?sprintId=`) |
| `/api/projects/{slug}/epics`, `/api/projects/{slug}/epics/{id}` | GET, POST / GET, PUT, DELETE |
| `/api/projects/{slug}/qa` | GET (queues), POST (verdict: `{ taskId, version, verdict: pass \| rework, note }`) |

### Versions, proposals, tasks

| Route | Methods |
|---|---|
| `/api/projects/{slug}/versions` | GET, POST |
| `/api/projects/{slug}/versions/{version}` | GET, PUT |
| `/api/projects/{slug}/proposals` | GET, POST |
| `/api/projects/{slug}/proposals/{id}` | GET, PUT, DELETE |
| `/api/projects/{slug}/proposals/{id}/promote` | POST |
| `/api/projects/{slug}/tasks` | GET, POST |
| `/api/projects/{slug}/tasks/{taskId}` | GET, PUT, PATCH, DELETE |
| `/api/projects/{slug}/tasks/{taskId}/history` | GET |
| `/api/projects/{slug}/versions/{version}/tasks[/{taskId}[/history]]` | version-scoped equivalents |
| `/api/projects/{slug}/media/{taskId}/{attId}` | GET (ETag, immutable cache) |

### Org-wide

| Route | Methods |
|---|---|
| `/api/assignees`, `/api/assignees/{name}` | GET, POST / PUT, DELETE |
| `/api/notifications`, `/api/notifications/{id}` | GET, POST / PATCH |
| `/api/holidays`, `/api/holidays/config` | GET, POST, PUT, DELETE |
| `/api/audit` | GET, DELETE |
| `/api/my-tasks` | GET (`?view=team`) |
| `/api/teams` | GET |
| `/api/people/{name}` | GET (`?project=`) |

### Admin

| Route | Methods |
|---|---|
| `/api/admin/users`, `/api/admin/users/{name}` | GET, POST / PUT, DELETE |
| `/api/admin/users/bulk-permissions` | POST |
| `/api/admin/user-access/{name}` | GET, PUT |
| `/api/admin/groups`, `/api/admin/groups/{id}` | GET, POST / PUT, DELETE |
| `/api/admin/role-policy` | GET, PUT, DELETE |
| `/api/admin/snapshots`, `/api/admin/snapshots/{id}` | GET, POST / GET, DELETE |

### Cron

| Route | Schedule |
|---|---|
| `/api/cron/due-reminders` | `0 8 * * *` |
| `/api/cron/delayed-reminders` | `0 12 * * *` |
| `/api/cron/sprint-rollover` | `35 18 * * *` |

---

## Scripts

```bash
node scripts/set-superadmin.js '<password>'    # print AUTH_SECRET + password hash
node scripts/hash-passwords.js --dry-run       # migrate plaintext passwords in Redis
node scripts/grant-all-admin-permissions.js    # grant every permission to admins
node scripts/store-report.js                   # read-only Redis size inventory
node scripts/migrate-task-media.js             # move inline attachment bytes to their own keys
node scripts/gen-app-routes.js                 # regenerate app/api/**/route.js after adding a server/api handler
OLD_REDIS_URL=… OLD_REDIS_TOKEN=… NEW_REDIS_URL=… NEW_REDIS_TOKEN=… \
  node scripts/migrate-redis.js                # copy one Upstash database into another
node scripts/seed-kv.js                        # seed projects/versions
node scripts/seed-tasks.js [slug]              # seed tasks for a project
```

---

## Graphify (code knowledge graph)

The repo is indexed into a queryable graph under `graphify-out/` — 1459 nodes and 2885
edges across 153 files, clustered into named communities. Use it to find where a concept
lives before grepping.

```bash
graphify update .                     # re-extract after code changes (no LLM, no API cost)
graphify query "how does auth work"   # BFS traversal for a question
graphify explain "requirePermission"  # plain-language node + neighbours
graphify affected "lib/task-media.js" # reverse traversal: what breaks if this changes
graphify path "KanbanBoard" "prd-store"
graphify watch .                      # rebuild on change
```

Outputs: `graphify-out/graph.json` (the graph), `graph.html` (interactive viewer),
`GRAPH_REPORT.md` (community hubs and freshness). The report records the commit it was
built from — compare against `git rev-parse HEAD` to check for staleness.

Separately, `scripts/generate_graph.py` + `graphify/graph.html` are a much smaller
starter that renders a dependency graph parsed straight out of `PRD.md`. See
[README-graphify.md](README-graphify.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 18, vanilla CSS in `styles/globals.css` (no CSS modules), shadcn/ui components (Tailwind v4 + Radix) in `components/ui/`, lucide icons |
| Charts | Hand-drawn SVG (`components/InsightsCharts.js`) |
| Store | Upstash Redis (`@upstash/redis`, auto-pipelining) |
| Auth | HMAC-signed HttpOnly cookie, scrypt password hashes |
| Markdown | remark |
| Diff | `diff` |
| Hosting | Vercel (crons in `vercel.json`) |

### Conventions

- API routes call `requirePermission` / `requireSuperAdmin` before mutating.
- Never read identity from a request header — `getSessionUser(req)` is the only entry point.
- Never store a password without `hashPassword()`.
- Client fetches go through `apiFetch`.
- New endpoint: handler in `server/api/`, then `node scripts/gen-app-routes.js`. Never
  edit `app/api/**/route.js` by hand. New page: component in `views/`, thin wrapper in
  `app/<route>/page.js`.
- Client routing imports `useRouter` from `lib/router-compat`, never `next/router`.
- Tailwind utilities only work in `components/ui/` and files listed with `@source` in
  `styles/app.css`; everywhere else, add classes to `globals.css`.
- Person names render through `PersonLink`; menus use `components/ui/dropdown-menu`.
- Colours come from the tokens in `:root` (`--bg`, `--surface`, `--card`, `--border`,
  `--text`, `--muted`, `--accent`, `--on-accent`, and the `--tint-{hue}-bg` / `-fg`
  pairs). A pale hex paired with dark ink is exactly what disappears in dark mode.
  Anything that genuinely must stay literal goes in the "Dark-mode exceptions" block at
  the bottom of `globals.css`.
- No TypeScript.

---

## Deploying

- **Hosting:** Vercel, with the crons in `vercel.json`. Set the environment variables
  above in the Vercel project; the live database is whatever `UPSTASH_REDIS_REST_URL`
  points at.
- **CI:** `.gitlab-ci.yml` runs `npm ci` and `npm run build` on Node 20 for branch pushes
  and merge requests. GitLab's shared runners need a verified account; an unverified one
  fails every pipeline before it starts. CI does not gate the Vercel deploy.
- **Before a release that changes stored data** (like the sprint split), copy the
  database first — `scripts/migrate-redis.js` can copy it into a spare Upstash database —
  and note the current production deployment.
- **Rolling back:** Vercel → Deployments → previous deployment → *Instant Rollback*, or
  revert the merge in GitLab. Code that only adds fields is safe to roll back; check the
  storage notes above for anything that rewrites data.
- Never commit credentials. Scripts read them from environment variables.

---

## Docs Map

| File | What it holds |
|---|---|
| [PRD.md](PRD.md) | The product requirements doc for this tool — the system as built, plus specified-but-not-yet-built sections |
| `/guide` (`views/guide.js`) | The in-app user guide: how to use each area, roles table, FAQ. Kept in step with the rules it describes |
| [.claude/CLAUDE.md](.claude/CLAUDE.md) | Working instructions: key files, conventions, priority order |
| [storage-audit.md](storage-audit.md) | Deep dive on Redis key growth and cost |
| [README-graphify.md](README-graphify.md) | The PRD.md-derived starter graph |
| [README-ui.md](README-ui.md) | UI notes |
| [docs/github-schema.md](docs/github-schema.md) | GitHub schema & PRD file format (from the v1 vision) |
| [docs/PRD-v1-graph-vision.md](docs/PRD-v1-graph-vision.md) | Archived — a Git/graph architecture that was never built |
