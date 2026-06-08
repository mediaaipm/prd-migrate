# PRD Manager

A web app for managing product requirement documents (PRDs), tasks, and proposals across multiple projects. Built with Next.js and deployed on Vercel, with Redis (Upstash) as the backend store.

---

## Quick Start

```powershell
npm install
npm run dev
```

Then open `http://localhost:3000` in your browser.

---

## Features

### Projects

- **Create projects** — give each project a name and optional description
- **Search projects** — filter by name or description from the home page
- **Delete projects** — admins can delete a project and all its data (with confirmation)
- Each project card shows the latest version and how many pending proposals exist

---

### Versions (PRD Editing)

Each project can have multiple versions of its PRD (e.g. `1.0.0`, `1.1.0`, `2.0.0`).

- **Create a new version** — bump major, minor, or patch from the project page
- **Edit a version** — opens a markdown editor; save commits the content to storage
- **View version history** — see all versions listed on the project page
- **Per-version tasks** — each version has its own task list (see Tasks section)

---

### Proposals

Proposals are draft changes that haven't been promoted to an official version yet.

- **Create a proposal** — give it a title, description, assignee, start date, and due date
- **Edit a proposal** — same markdown editor as versions
- **Promote a proposal to a version** — choose major/minor/patch bump; creates a new official version from the proposal
- **Delete a proposal** — removes it permanently (with confirmation)
- Proposals show their status: `pending`, `promoted`, or `rejected`

---

### Tasks

Tasks live inside a project and can be organized in a tree (parent/child) or Kanban board view.

- **Create tasks** — add title, description, assignee, status, priority, due date
- **Task tree view** — nested hierarchy showing parent → child relationships
- **Kanban board view** — columns for `todo`, `in-progress`, `done`
- **Reorder tasks** — drag or reorder within the list
- **Update task status** — move between todo / in-progress / done
- **Delete tasks** — remove a task (with confirmation)
- **Sprint view** — active sprint tasks shown on the tasks page with a progress bar

---

### Diff Viewer

Compare any two versions or proposals side by side.

- **Split view** — old on the left, new on the right, line-by-line diff
- **Unified view** — single-column diff with additions and deletions highlighted
- **Select what to compare** — pick any version or proposal as left or right side
- Access from the project page via the "Diff" link

---

### Project Dashboard

Per-project stats and overview.

- Total tasks, tasks by status, completion percentage
- Progress bar per version
- Recent activity summary

---

### Admin Panel

Only accessible to users with admin or superadmin role. Go to `/admin`.

#### Users Tab
- Add users (display name, username, password)
- Edit user credentials (username and/or password)
- Remove users

#### Admins Tab _(superadmin only)_
- Add admin users with granular permissions
- Permissions you can grant or revoke per admin:
  - `project:create`, `project:update`
  - `proposal:create`, `proposal:update`, `proposal:delete`, `proposal:promote`
  - `task:create`, `task:update`, `task:delete`
  - `assignee:manage`, `snapshot:manage`, `audit:view`
- **Project access control** — restrict an admin to specific projects only, or grant access to all
- Change any admin's password
- Remove admins

#### Snapshots Tab
- Take a named snapshot of all project data at a point in time
- View snapshot details (how many versions and proposals per project)
- Delete old snapshots

#### Audit Log Tab
- See every action taken in the system: who did what and when
- Actions tracked: logins, logouts, project/version/proposal/task/user/snapshot create/update/delete operations
- Search logs by user, action type, or details
- Paginated (50 per page), with Newer/Older navigation

---

### Authentication

- Login at `/api/auth/login` with username + password
- Logout via nav bar
- Session-based (cookie)
- Unauthenticated users are redirected to login

---

## Pages Reference

| URL | What it does |
|-----|-------------|
| `/` | List all projects |
| `/projects/[slug]` | Project overview — versions, proposals |
| `/projects/[slug]/tasks` | Task list (tree + kanban) with sprint view |
| `/projects/[slug]/dashboard` | Project stats and progress |
| `/projects/[slug]/diff` | Compare two versions or proposals |
| `/editor?slug=...&version=...` | Edit a specific version |
| `/editor?slug=...&type=proposal&id=...` | Edit a proposal |
| `/admin` | Admin panel (users, admins, snapshots, audit log) |

---

## Tech Stack

- **Frontend** — Next.js, React
- **Storage** — Upstash Redis (via REST API)
- **Deployment** — Vercel
- **Markdown editor** — custom editor component
- **Diff** — custom diff viewer component
