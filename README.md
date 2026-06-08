# PRD Manager

A product requirements document (PRD) management system built with Next.js. It combines version-controlled PRDs, proposal workflows, hierarchical task tracking, sprint planning, and team analytics in one tool.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Features](#features)
  - [Projects](#projects)
  - [PRD Versions & Proposals](#prd-versions--proposals)
  - [Tasks](#tasks)
  - [Active Sprint](#active-sprint)
  - [Insights Dashboard](#insights-dashboard)
  - [Admin Panel](#admin-panel)
- [Active Sprint — Full Guide](#active-sprint--full-guide)
  - [What Is an Active Sprint?](#what-is-an-active-sprint)
  - [Why Use Sprints?](#why-use-sprints)
  - [How to Start a Sprint](#how-to-start-a-sprint)
  - [Managing a Sprint](#managing-a-sprint)
  - [Ending a Sprint](#ending-a-sprint)
  - [Sprint on the Dashboard](#sprint-on-the-dashboard)
- [Tech Stack](#tech-stack)

---

## Overview

PRD Manager helps product and engineering teams manage the full lifecycle of a feature — from writing and versioning the PRD, through proposal reviews, to breaking work into tasks and executing in focused sprints.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Vercel KV](https://vercel.com/docs/storage/vercel-kv) database (Redis-compatible)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
KV_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Projects

The home page lists all tracked projects. Each project card shows the latest version, pending proposal count, and a direct link to its tasks.

Create a project by clicking **New Project** and providing a name and optional description.

### PRD Versions & Proposals

Each project stores its PRD as versioned markdown (semantic versioning — `major.minor.patch`). You can:

- Open the rich editor to write or update PRD content
- Save a new version bump (patch / minor / major)
- Create proposals — draft changes that can be reviewed and promoted to a new version
- Compare any two versions or proposals side-by-side with the diff viewer

### Tasks

Tasks live at the project level (or scoped to a specific version). They support:

- **Hierarchical structure** — parent tasks with unlimited sub-tasks, auto-numbered (1, 1.1, 1.2.3)
- **Statuses** — Backlog, To Do, In Progress, In Review, Done
- **Priority** — Low, Medium, High
- **Assignees** — one or more team members per task
- **Dates** — start date and due date
- **Updates** — comment/notes history per task
- **Two views** — List (tree) view and Kanban board (drag-and-drop columns)

### Active Sprint

A focused, time-boxed iteration within a project. See the [full guide below](#active-sprint--full-guide).

### Insights Dashboard

A cross-project analytics dashboard at `/dashboard` with:

- **Active Sprints** — progress and days remaining for every project with a running sprint
- **Overdue items** — tasks and proposals past their due date
- **Upcoming deadlines** — items due in the next 7 days
- **Project completion** — percentage of done tasks per project
- **Team workload** — open tasks per assignee
- **Pending proposals** — backlog of un-reviewed proposals
- **Task velocity** — tasks completed this week vs last week
- **Unassigned items** — open items with no owner
- **Stale projects** — projects with no activity in 14+ days
- **Last activity** — most recent action per project

### Admin Panel

Available at `/admin` (admin users only):

- **Users** — add, edit, and remove team members
- **Snapshots** — take and restore point-in-time backups of all project data
- **Audit Log** — full timestamped history of every action (create, update, promote, login, etc.)

---

## Active Sprint — Full Guide

### What Is an Active Sprint?

An **Active Sprint** is a short, focused work cycle scoped to a single project. You pick a subset of tasks, give the sprint a name and a time window (e.g. two weeks), and the sprint section surfaces those tasks prominently at the top of the Tasks page so the whole team knows exactly what is in scope for this iteration.

Each project can have **one active sprint at a time**.

---

### Why Use Sprints?

| Without sprints | With sprints |
|---|---|
| The task backlog can grow to hundreds of items — it is easy to lose focus | The sprint shows only the agreed tasks for this cycle |
| No shared sense of what needs to be done *this week* | Everyone sees the same sprint goal and deadline on the Tasks page |
| Hard to measure iteration progress | The progress bar shows done/total at a glance |
| No urgency signal until a due date is missed | Days-remaining badge turns amber (≤2 days) or red (overdue) |
| Cross-project status requires checking each project individually | The Dashboard Active Sprints panel shows all running sprints in one place |

Sprints are especially useful when:

- A team is executing on a specific PRD version
- You are running a time-boxed bug-bash or polish cycle
- A project has a hard external deadline and you need to track daily progress
- Multiple projects are running in parallel and you need a bird's-eye view on the Dashboard

---

### How to Start a Sprint

1. Navigate to a project's **Tasks** page (`/projects/<slug>/tasks`).
2. At the top of the page, above the task list, you will see the Active Sprint section showing **"No active sprint"**.
3. Click **+ Start Sprint**.
4. Fill in the form:
   - **Sprint Name** *(required)* — e.g. `Sprint 3` or `v2.1 Launch Prep`
   - **Start Date** *(optional)* — the date the sprint begins
   - **End Date** *(optional)* — the target completion date; drives the days-remaining badge
   - **Tasks in Sprint** — check the tasks you want to include in this sprint. Only root-level (top-level) tasks are shown; their sub-tasks are implicitly included in the scope.
5. Click **Start Sprint** to activate it.

The sprint section will now appear at the top of the Tasks page with the progress bar and task chips.

---

### Managing a Sprint

Once a sprint is active you can update it at any time:

1. Click **Manage** in the sprint section header.
2. The same form opens pre-filled with current values.
3. Change the name, dates, or task selection as needed.
4. Click **Save Changes**.

**Sprint task chips** are shown inline in the sprint section. Each chip shows:

- A colored dot: green = done, blue = in-progress, grey = to do
- The task number (e.g. `#3`)
- The task title (struck through when done)

The **progress bar** updates automatically as tasks are moved to Done in the list or Kanban view below — just refresh the page to see the latest count.

**Days-remaining badge** color codes:

| Color | Meaning |
|---|---|
| Green | More than 2 days remaining |
| Amber | 2 days or fewer remaining |
| Red | End date has passed (sprint overdue) |

---

### Ending a Sprint

When the sprint cycle is complete:

1. Click **End Sprint** in the sprint section header.
2. Confirm the prompt.

The sprint is permanently removed and the section resets to "No active sprint", ready for the next cycle. Completed task statuses are preserved — ending a sprint does not change any task data.

---

### Sprint on the Dashboard

The **Insights Dashboard** (`/dashboard`) shows an **Active Sprints** panel as the first section, immediately below the KPI cards. For every project that has a running sprint, the panel displays:

| Column | Description |
|---|---|
| Project / Sprint name | Links directly to the project's Tasks page |
| Progress bar | Visual done/total ratio |
| Done/Total count | Exact numbers next to the bar |
| End date | Human-readable end date |
| Days left badge | Same color coding as on the Tasks page |

This gives leadership and cross-functional stakeholders a single view of iteration health across all projects without navigating into each one individually.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 13 (Pages Router) |
| UI | React 18, inline CSS-in-JS |
| Database | Vercel KV (Redis) |
| Markdown | Remark |
| Diff | diff package |
| Hosting | Vercel |
