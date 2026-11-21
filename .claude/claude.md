# CLAUDE.md — PRD Manager

## Communication

Caveman mode always on. Short. No fluff. Bullets over paragraphs. No pleasantries.

Bad: "I investigated and identified the root cause."
Good: "Bug in auth middleware. Fix:"

Skip summary at end of response. User reads diff.

---

## Project: PRD Manager

Next.js 16 (App Router) + Upstash Redis. Product requirements & task management tool.

**Stack:**
- Frontend: Next.js, React, vanilla CSS (`styles/globals.css`) skinned to the shadcn/ui look, plus real shadcn components (Tailwind v4 + Radix) in `components/ui/`
- Backend: pages-style handlers in `server/api/`, served by generated App Router routes in `app/api/**/route.js` through `lib/route-adapter.js`
- Store: Upstash Redis via `lib/prd-store.js`
- Auth: HMAC-signed HttpOnly session cookie (`prd_session`). Roles (`lib/roles.js`): `superadmin` / `admin` / `manager` / `teamlead` / `dev` / `qa` — stored on `user:{name}.role`; a missing role reads as `dev`. Passwords stored as scrypt hashes.

**Key entities:**
- **Project**: `{ slug, name, description, status, priority, members[], createdAt, latestVersion, pendingProposals }`
- **Task**: `{ id, title, status, priority, assignees[], parentId, dueDate, startDate, order, number }`
- **Version**: markdown content per semver tag
- **Proposal**: suggested changes to a version, status: `pending|promoted|rejected`
- **Sprint**: plans **stories** (`storyIds`; sub-tasks ride along, `taskIds` is the derived expansion), status `planned|active|completed`. One active per project; a story in ≤1 open sprint. Completing freezes the result (`frozen`, `summary`) and carries unfinished stories into the next sprint (`task.carryOver` += 1). Cadence (`sprint-config:{slug}`: weeks, start/end weekday, `autoRollover`, `autoStart`, `alwaysCreateNext`, `earlyComplete`) is applied by `applyCadence()` on sprint GET and the daily `/api/cron/sprint-rollover`. Defaults: 2 weeks Mon→Fri; closes at the end of Friday, unfinished stories carried; next sprint always opened and starts itself Monday; manual "Complete sprint" only from the last day (enforced in `completeSprintLocked`, not just hidden)
- **Epic**: `{ id, name, description, color, status: planned|in-progress|done, owner, startDate, targetDate, order }` — groups stories across versions. Epic › story › sub-task
- **Group**: `{ id, name, description, permissions[], assignedProjects[]|null, members[] }` — a bundle of permissions + project visibility granted to every member (union, never subtractive). Superadmin-only.

**Access model (three layers, all enforced server-side):**
1. `role-policy` / `role-policy:{slug}` — the ceiling per role, per project (`/settings/roles`). Buckets `admin`, `manager`, `teamlead`, `user` (= Dev), `qa`; pick one with `ceilingFor(policy, role)` — never `role === 'admin' ? admin : user`
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
| `lib/session-live.js` | Re-checks the cookie against `user:{name}` once per API request (run by the route adapter): role read live from Redis, deleted accounts and password changes (`sessV`) revoke sessions, built-in admin tied to the env secret |
| `lib/password.js` | scrypt hash/verify (accepts legacy plaintext, flags for re-hash) |
| `lib/login-rate-limit.js` | Per-username + per-IP login throttle |
| `lib/api-fetch.js` | Client-side fetch wrapper (session rides on the cookie) |
| `lib/require-permission.js` | `requirePermission(perm, slug)`, `requireProjectAccess`, `visibleProjects` |
| `lib/require-superadmin.js` | Super-admin gate |
| `lib/roles.js` | Role list, labels, `ceilingFor()`, `isLeadUser()` (superadmin/admin/manager/teamlead: add stories, skip the status blocklist) |
| `lib/qa-store.js` | QA review: queue, verdict (pass → Done, rework → `need-rework` + current sprint), Rework column, QA notifications |
| `views/projects/[slug]/qa.js` | QA board — Waiting / Sent back / Passed; verdict API `server/api/projects/[slug]/qa.js`. "Open card" = in-page `QaCardModal` (full task via task GET, `subtaskList` from the queue, acceptance ticks via task PUT, verdict buttons in its footer) — never navigate away |
| `lib/permissions.js` | Permission catalogue + labels + role defaults (`PERMS_VERSION`) |
| `lib/role-policy.js` | Per-role, per-project ceiling (`role-policy`, `role-policy:{slug}`) |
| `lib/user-access.js` | Merged personal + group grant for one account (the resolver) |
| `lib/group-store.js` | Group CRUD + membership (`groups`, `group:{id}`, `user-groups:{name}`) |
| `lib/sprint-store.js` | Sprint lifecycle: plan/start/complete, carry-over, cadence, legacy migration, `sprintTasks()` (frozen view for metrics) |
| `lib/sprints.js` | Client: `useSprints`, sprint actions, progress helpers |
| `views/projects/[slug]/sprints.js` | Sprints area — tabs: Current / Plan / All sprints / Metrics |
| `lib/epic-store.js` | Epic CRUD + cross-version progress roll-up + `epicLinkError()` guard |
| `lib/epics.js` | Client: `useEpics`, `setStoryEpic`, `storyOf`/`epicIdOf` |
| `views/projects/[slug]/epics.js` | Epics page — cards, progress, link/unlink stories |
| `views/projects/[slug]/dashboard.js` | Insights — hero progress, stat tiles, burndown, pipeline, sprint history, QA, workload, epics. Data from `server/api/projects/[slug]/dashboard.js`; charts are hand-drawn SVG in `components/InsightsCharts.js` using the `--chart-*` tokens (blue/orange pair validated for CVD, both themes) |
| `views/projects/[slug]/backlog.js` | Backlog — stories in `backlog` status, grouped by epic |
| `components/PermissionGrid.js` | Shared permission chips + project picker |
| `components/GroupsTab.js` | Admin → Groups: create/edit groups, add members |
| `components/UserAccessEditor.js` | Admin → Users → Access: per-user perms, projects, groups |
| `server/api/projects/` | API handlers (`handler(req, res)`): projects, versions, tasks, proposals, sprints, epics |
| `app/api/**/route.js` | **Generated** by `scripts/gen-app-routes.js` — never edit; edit `server/api` and re-run |
| `lib/route-adapter.js` | Runs a pages-style handler as an App Router route (body parsing, query, ETag/304, cookies) |
| `app/**/page.js` | Thin client wrappers: render a `views/` component with `useCurrentUser()` |
| `components/AppShell.js` | Login gate, current-user context, SyncStatus (was `_app.js`) |
| `lib/router-compat.js` | Pages-style `useRouter()` on `next/navigation` — views import this, never `next/router` |
| `views/index.js` | Project list |
| `views/my-tasks.js` | My tasks (`/my-tasks`) — tasks assigned to the signed-in account across visible projects, grouped by due date; Done = last 30 days. API `server/api/my-tasks.js` (per-project `project:view` + `task:view`) |
| `lib/team.js` | Teams: `user:{name}.lead` = the person's team lead. Ladder Dev/QA → Team lead → Manager (Manager → Manager ok) via `canLead()` in `lib/roles.js` (shared with the Admin picker); no loops — `leadError()`. Role change / becoming admin clears links that no longer fit (`brokenLinks()`). `getTeam()` = direct + indirect reports; for a Manager, every team (`allTeams()`). Set via `PUT /api/assignees/{name} { lead }` (`assignee:manage`); delete/rename cascade. My tasks `?view=team` shows the team's tasks, limited to the caller's own visible projects |
| `views/teams.js` | Teams (`/teams`, Nav link for manager/teamlead) — team details + insights. API `server/api/teams.js`: manager = every team, others = teams they lead (and leads under them); team = lead + direct reports; stats only from the caller's visible projects; team totals dedupe shared tasks. Throughput chart `WeeklyBars` in `components/InsightsCharts.js` |
| `views/guide.js` | `/guide` — how to use the tool, linked from the top bar. Describes real behaviour (cadence defaults, sub-task rules, who can add what, roles table): **update it in the same change** when any of those rules change |
| `views/projects/[slug]/tasks.js` | Task list + kanban toggle |
| `components/KanbanBoard.js` | Kanban — columns are global per project, superadmin-only edit |
| `lib/kanban-columns.js` | Column layout: server is truth (`columns:{slug}`), localStorage is a first-paint cache |
| `lib/categories.js` | Task categories (`categories:{slug}`) — the second grouping axis; same server-is-truth pattern as columns |
| `components/CategoryManager.js` | Categories modal — superadmin edits, everyone reads |
| `lib/task-acceptance.js` | Acceptance criteria on a story — sanitize/stamp + the author-vs-tick guard |
| `components/TaskTree.js` | Tree list view with inline edit |
| `components/Nav.js` | Global top bar (Projects, My tasks, Teams for managers/team leads; right: theme picker, notifications, Guide button, user menu with Admin/Access control/Sign out) + the **project bar** (breadcrumb + tabs: Tasks, Backlog, Sprints, Epics, Project Version, Insights). Pages pass `projectName` |
| `components/PageHeader.js` | Every page's header: title, one-line subtitle, page actions. No navigation links here |
| `components/MoreMenu.js` | `⋯` menu for secondary actions (`[{ label, onClick, danger, hidden }]`) |
| `lib/theme.js` | Themes — `localStorage['ss_theme']`, falls back to OS preference (`followSystem()` clears the choice). The list (id, mode, blurb, picker `swatch`) is `lib/theme-registry.js`; tokens per theme in `globals.css` `html[data-theme=…]`. Every theme passes WCAG AA for text, muted, accent, on-accent and tint chips — re-check when adding one |
| `app/layout.js` | Root layout; inline pre-paint script that stamps `<html data-theme>` (no white flash) |
| `styles/globals.css` | All app styles — no CSS modules. Ends with the **shadcn skin** block (restyles app classes) then the dark-mode exceptions |
| `styles/app.css` | CSS entry: layer order (theme, base=globals.css, utilities), Tailwind `@source` list, shadcn colour names mapped onto app tokens |
| `components/ui/` | shadcn components (JS): `button`, `dropdown-menu`. Add more with `npx shadcn@latest add <name>` (`components.json`), then convert to `.js` |
| `lib/utils.js` | `cn()` — shadcn class combiner |

---

## Code Conventions

- API routes: use `requirePermission` or `requireSuperAdmin` before mutations
- New endpoint: add a handler under `server/api/` (same path rules pages/api had), then `node scripts/gen-app-routes.js`. New page: component in `views/`, wrapper in `app/<route>/page.js` (copy an existing one)
- Client routing: import `useRouter` from `lib/router-compat`, never `next/router` (it does not exist in the App Router)
- Never read identity from a request header. `getSessionUser(req)` from `lib/session.js` is the only entry point
- Never store a password without `hashPassword()`
- Client fetches: always use `apiFetch`, not raw `fetch`
- Redis keys: `project:{slug}`, `task:{slug}:{id}`, `version:{slug}:{ver}`, `sprint:{slug}:{id}` + `sprints:{slug}` (index) + `sprint-config:{slug}` (legacy `sprint:{slug}` array is a read-only backup), `group:{id}`, `user-groups:{name}`, `columns:{slug}`, `categories:{slug}`, `epic:{slug}:{id}`, `epics:{slug}` (index set)
- A **story** is a root-level task (`parentId === null`) — the lane on the swimlane board. There is no separate entity. `task.acceptance` (its acceptance criteria) and `task.userStory` (`{ role, goal, benefit }` — "As a… I want… so that…", `lib/user-story.js`, null on sub-tasks, absent until written) belong there; both are written in `TaskForm` (create + edit, sent only when changed) and the board card modal; sub-tasks are how a story gets built, not separate contracts
- `task.epicId` lives on **stories only**. `saveTasks()` strips it from any task with a parent; read a sub-task's epic through its story (`epicIdOf()`). Any route that writes `epicId` must call `epicLinkError()`. Epic create/edit = `project:update`, delete = superadmin (unlinks stories, never deletes them)
- Sub-tasks have three statuses — Not started (`todo`) / In progress / Done (`lib/subtask-status.js`). Only stories (root tasks) are cards and drag between board columns; sub-tasks are rows under their story (`components/SubtaskList.js`) with their own status picker. Status pickers go through `statusOptions(columns, task)`. Server: `createTask` snaps a sub-task's status onto the three; `updateTask` rejects a *changed* status outside them (`TaskStatusError` → 400) but keeps an old column status echoed back unchanged
- A story moved to Done closes its open sub-tasks (`lib/task-cascade.js`, inside the same locked write, `task:update` holders only; clients mirror it with `statusOptimistic()`). Any other story move leaves sub-task statuses alone. Done sub-tasks are never reopened
- Story points are Fibonacci: 1, 2, 3, 5, 8, 13, 21 (`lib/story-points.js`), blank = unestimated. Pick with `components/PointsSelect`. `createTask` snaps onto the scale; `updateTask` rejects a *changed* off-scale value (`TaskPointsError` → 400) but keeps an old estimate echoed back unchanged
- Devs and QA add **children only** (sub-tasks and below), never a story: `MIN_ADMIN_DEPTH = 1` in `lib/task-nesting.js` (server, every create/reparent route), mirrored by `canAddUnder()` in `lib/client-permissions.js`. Leads (`isLeadUser`) are uncapped. They hold `task:create` by default (`DEFAULT_ROLE_POLICY.user`; `POLICY_VERSION` 3 adds it to stored policies once — a superadmin can remove it and it stays removed)
- A story created without an explicit status starts in `backlog` (task POST routes); planning it into a sprint moves it to `todo`
- Sprint writes need `project:update`; deleting a completed sprint needs superadmin. Metrics for a closed sprint must go through `sprintTasks()`, never live task status
- Acceptance criteria have a split write rule: authoring needs `task:update`, ticking needs only card access. Enforced by `acceptanceStructureIntact()` in the task PUT routes — never by hiding the button. A new route accepting task objects must apply the same guard
- `task.category` holds a category **id**, never a name. Read it through `effectiveCategory()` so ancestor inheritance applies — reading the raw field misses every sub-task that inherits
- Never read `user:{name}.permissions` directly — go through `getUserAccess()` so groups and the legacy-permission upgrade are applied
- New permissions must be added to `ALL_PERMISSIONS` **and** `PERMISSION_GROUPS`, and `PERMS_VERSION`/`POLICY_VERSION` bumped if omitting them from a stored list would revoke access
- Tasks are flat in Redis; `buildTree()` in TaskTree constructs hierarchy client-side
- Near-static GETs are browser-cached 60s (`sendJsonConfig` in `lib/etag.js`): columns, categories, labels, `/api/assignees`, `/access`. Readers build the URL with `withRev()` / `assigneesUrl()` / `accessUrl()` from `lib/config-cache.js`; a writer bumps the rev so its own next read misses. `/access` URLs carry the username — never cache a per-user response under a shared URL
- Need only the project record (name, prefix, taskAcl)? `getProjectMeta()`, not `getProject()` — the latter loads every version's markdown and all proposals
- Don't audit reads (`logAudit` on GET): the log is capped at 2000 and page views pushed real changes out
- Heavy, non-default views load via `next/dynamic` (board, calendar, sprint metrics) — keep it that way for new big tabs
- Task-list writes go through `saveTasks()` inside `withTaskLock()`; the save is fenced on the lock token and throws `TaskLockError` (503, replayed by the client) if the lock expired mid-cycle. Never `SET` a `tasks:` key directly
- Slug = lowercased kebab-case project name (immutable after creation)
- Status values: `backlog | todo | in-progress | need-rework | in-review | blocked | done` (extendable via custom columns). `in-review` is labelled **QA Review**; `need-rework` is **Rework**
- QA flow (`lib/qa-store.js`): a story moved to `in-review` gets `task.qa.state = 'review'` and QA accounts are notified. Verdicts go only through `POST /api/projects/{slug}/qa` (`qa:review`): pass → `done` (cascade closes sub-tasks; unmet acceptance needs `allowUnmet`), rework → `need-rework` with a required note (comment + notification), placed in the active sprint (else next planned). `updateTask(..., { ifStatus })` rejects a second verdict (409). `task.qa` is server-owned — the task PUT routes drop it from bodies. A QA assigned to a story cannot pass it; leads can. Role changes: `PUT /api/assignees/{name} { role }` (team roles only, never own role, Manager only by an admin)
- Priority values: `low | medium | high`
- Project status: `active | on-hold | archived`
- CSS: add new classes to `globals.css`; no inline styles for layout (use existing utility classes)
- Tailwind utilities only in `components/ui/` and files listed with `@source` in `styles/app.css` (currently Nav, MoreMenu). Tailwind does **not** scan views/ — a utility class there silently does nothing. New file using utilities → add an `@source` line
- Menus/popovers: use `components/ui/dropdown-menu` (via `MoreMenu` for ⋯ actions), not a hand-rolled outside-click menu. shadcn colour names (`bg-primary`, `text-muted-foreground`, `bg-accent`) map to app tokens — app `--accent` = shadcn `primary`, app `--muted` = shadcn `muted-foreground`
- UI: navigation belongs to the Nav/project bar only — never repeat section links as header buttons. A page header holds its primary action (one `btn-primary`) and at most a view switch; everything secondary goes in a `MoreMenu`. Rows show one primary action + `⋯`
- Colours: never hard-code a hex for a surface or for text. Use the tokens in `:root` (`--bg`, `--surface`, `--card`, `--surface-2`, `--border`, `--text`, `--muted`, `--hover`, `--overlay`), `--on-accent` for ink sitting on an `--accent` fill, and the `--tint-{hue}-bg` / `--tint-{hue}-fg` **pairs** for status chips — every one has a dark counterpart under `html[data-theme="dark"]`. A pale hex paired with dark ink is the exact combination that turns invisible in dark mode. Saturated fills (priority dots, user-chosen label/column colours) can stay literal
- Anything that genuinely must stay a literal goes in the "Dark-mode exceptions" block at the bottom of `globals.css`. If a colour arrives from data, pass it in as `--status-color` and derive the wash/ink in CSS — inline styles can't tell which theme is on
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
