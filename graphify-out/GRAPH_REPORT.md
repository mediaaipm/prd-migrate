# Graph Report - .  (2026-06-24)

## Corpus Check
- 6 files · ~50,245 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 686 nodes · 1245 edges · 47 communities (40 shown, 7 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.89)
- Token cost: 0 input · 88,892 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Handlers & Audit|API Handlers & Audit]]
- [[_COMMUNITY_REST API Endpoints|REST API Endpoints]]
- [[_COMMUNITY_Calendar View & Task Forms|Calendar View & Task Forms]]
- [[_COMMUNITY_PRD Store (Redis CRUD)|PRD Store (Redis CRUD)]]
- [[_COMMUNITY_Editor, Nav & Admin UI|Editor, Nav & Admin UI]]
- [[_COMMUNITY_Snapshot & Audit Store|Snapshot & Audit Store]]
- [[_COMMUNITY_Product Concepts & Integrations|Product Concepts & Integrations]]
- [[_COMMUNITY_Auth & Graph Viz|Auth & Graph Viz]]
- [[_COMMUNITY_Dashboard Panels|Dashboard Panels]]
- [[_COMMUNITY_Sprint Store|Sprint Store]]
- [[_COMMUNITY_Notification Store|Notification Store]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Graph JSON Data|Graph JSON Data]]
- [[_COMMUNITY_Graphify Detect Config|Graphify Detect Config]]
- [[_COMMUNITY_Task API & Snapshots|Task API & Snapshots]]
- [[_COMMUNITY_Diff & PRD Entities|Diff & PRD Entities]]
- [[_COMMUNITY_Permissions & Auth|Permissions & Auth]]
- [[_COMMUNITY_Core Entities & Views|Core Entities & Views]]
- [[_COMMUNITY_Version Content JSON|Version Content JSON]]
- [[_COMMUNITY_Graph JSON Data 2|Graph JSON Data 2]]
- [[_COMMUNITY_Store & Middleware Refs|Store & Middleware Refs]]
- [[_COMMUNITY_Seed Tasks Script|Seed Tasks Script]]
- [[_COMMUNITY_Superadmin Index API|Superadmin Index API]]
- [[_COMMUNITY_Project Meta|Project Meta]]
- [[_COMMUNITY_Project Meta 2|Project Meta 2]]
- [[_COMMUNITY_Legacy PRD Graph Gen|Legacy PRD Graph Gen]]
- [[_COMMUNITY_Named Resource API|Named Resource API]]
- [[_COMMUNITY_PRD Save & Webhook|PRD Save & Webhook]]
- [[_COMMUNITY_AST Artifact|AST Artifact]]
- [[_COMMUNITY_Redis Migration|Redis Migration]]
- [[_COMMUNITY_Version JSON|Version JSON]]
- [[_COMMUNITY_Project Config|Project Config]]
- [[_COMMUNITY_Vercel Deploy Config|Vercel Deploy Config]]
- [[_COMMUNITY_Diff Viewer|Diff Viewer]]
- [[_COMMUNITY_Vercel Cron Config|Vercel Cron Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_PRD Manager UI Package|PRD Manager UI Package]]
- [[_COMMUNITY_PRD Editor UI README|PRD Editor UI README]]
- [[_COMMUNITY_PyYAML Dependency|PyYAML Dependency]]

## God Nodes (most connected - your core abstractions)
1. `logAudit()` - 42 edges
2. `apiFetch()` - 27 edges
3. `requireProjectAccess()` - 26 edges
4. `getKv()` - 20 edges
5. `Audit Log (getAuditLogs)` - 18 edges
6. `Dashboard API Handler` - 18 edges
7. `listTasks()` - 16 edges
8. `PRD Knowledge Graph Viewer` - 16 edges
9. `handler()` - 15 edges
10. `getProject()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `refreshProjectStats()` --semantically_similar_to--> `Dashboard Data Aggregation`  [INFERRED] [semantically similar]
  lib/prd-store.js → pages/api/dashboard/index.js
- `getTasksForProject()` --semantically_similar_to--> `listTasks()`  [INFERRED] [semantically similar]
  pages/api/dashboard/index.js → lib/task-store.js
- `GitHub as Database (No Traditional DB)` --conceptually_related_to--> `Vercel KV (Redis-backed store)`  [INFERRED]
  PRD.md → pages/api/dashboard/index.js
- `AdminPage()` --references--> `Audit Trail Pattern`  [INFERRED]
  pages/admin.js → .graphify_detect.json
- `Graph Generator Script (Python)` --implements--> `Graphify Graph Engine`  [INFERRED]
  scripts/generate_graph.py → PRD.md

## Hyperedges (group relationships)
- **Three task views render the same task data** — components_kanbanboard_kanbanboard, components_calendarview_calendarview, components_tasktree_tasktree, concept_task_entity [INFERRED 0.85]
- **Task views mutate tasks through apiFetch wrapper** — components_kanbanboard_updatestatus, components_calendarview_reschedule, components_tasktree_dnd, lib_api_fetch_apifetch [INFERRED 0.75]
- **Inline data-URL attachment + cover pattern across forms** — components_kanbanboard_kanbanboard, components_calendarview_daytaskform, components_tasktree_taskform, concept_attachment_cover [INFERRED 0.75]

## Communities (47 total, 7 thin omitted)

### Community 0 - "API Handlers & Audit"
Cohesion: 0.06
Nodes (72): getKv(), handler(), { logAudit }, { Redis }, getKv(), handler(), { logAudit }, { Redis } (+64 more)

### Community 1 - "REST API Endpoints"
Cohesion: 0.05
Nodes (59): Assignees API (list/create), Assignee API (delete/update by name), Audit API (list/clear), Auth Login API, Auth Logout API, Dashboard API Handler, Diff API Endpoint, Project API Endpoint (+51 more)

### Community 2 - "Calendar View & Task Forms"
Cohesion: 0.06
Nodes (47): AssigneeInput Component, blankForm(), DayTaskForm(), dueKey(), MONTHS, PRIORITY_COLOR, reschedule (set dueDate via drag), CalendarView saveTask (+39 more)

### Community 3 - "PRD Store (Redis CRUD)"
Cohesion: 0.08
Nodes (47): bumpVersion(), createLabel(), createProject(), createProposal(), createVersion(), deleteLabel(), deleteProject(), deleteProposal() (+39 more)

### Community 4 - "Editor, Nav & Admin UI"
Cohesion: 0.06
Nodes (28): Editor(), renderMarkdown(), apiFetch(), apiFetchOrLogout(), ACTION_LABELS, AdminPage(), UserRow(), Editor (+20 more)

### Community 5 - "Snapshot & Audit Store"
Cohesion: 0.07
Nodes (31): { getAuditLogs }, getKv(), { getSprints }, handler(), { kv }, { listProjects, listProposals }, { Redis }, { kv } (+23 more)

### Community 6 - "Product Concepts & Integrations"
Cohesion: 0.09
Nodes (33): KanbanBoard Component, TaskTree Component, Agora Integration (Audio/Video Calls), CometChat Integration (Chat), Commission Cascade (boostâ†’per-astrologerâ†’systemâ†’fallback), Consultation State Machine (PENDINGâ†’ACCEPTEDâ†’CONFIRMEDâ†’COMPLETED), GitHub as Database (No Traditional DB), Graphify Graph Engine (+25 more)

### Community 7 - "Auth & Graph Viz"
Cohesion: 0.09
Nodes (30): Admin Panel, API-004, Authentication System, Login, Mobile App, Platform Team, Single Sign-On (SSO), Token Management (+22 more)

### Community 9 - "Sprint Store"
Cohesion: 0.16
Nodes (21): deleteSprint(), getKv(), getSprints(), { kv }, { Redis }, saveSprint(), saveSprints(), sprintKey() (+13 more)

### Community 10 - "Notification Store"
Cohesion: 0.17
Nodes (17): { addNotification }, handler(), { listProjects }, { listTasks }, addNotification(), getKv(), key(), listNotifications() (+9 more)

### Community 11 - "Package Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, diff, dotenv, next, react, react-dom, remark, @upstash/redis (+10 more)

### Community 12 - "Graph JSON Data"
Cohesion: 0.12
Nodes (14): edges, meta, prds, projects, proposals, versions, nodes, edges (+6 more)

### Community 13 - "Graphify Detect Config"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 14 - "Task API & Snapshots"
Cohesion: 0.22
Nodes (14): Task API Handler ([taskId].js), Full-State Snapshot Capture, Vercel KV Store, deleteTask Function, getTask Function, logAudit Function, reorderTask Function, requireAdmin Function (+6 more)

### Community 15 - "Diff & PRD Entities"
Cohesion: 0.20
Nodes (9): Proposal Entity, Version Entity, Authentication (Session Cookie), Next.js, PRD Manager (UI Guide), Project Dashboard, Proposals, Versions (PRD Editing) (+1 more)

### Community 16 - "Permissions & Auth"
Cohesion: 0.20
Nodes (9): { ALL_PERMISSIONS }, getKv(), handler(), { logAudit }, { Redis }, additionalDirectories, allow, ALL_PERMISSIONS (+1 more)

### Community 17 - "Core Entities & Views"
Cohesion: 0.24
Nodes (11): buildTree() Client-Side Hierarchy, Project Entity, Sprint Entity, Task Entity, Redis Key Scheme, Immutable Kebab-Case Slug, Kanban Board View, Projects Feature (+3 more)

### Community 18 - "Version Content JSON"
Cohesion: 0.24
Nodes (7): content, createdAt, version, content, createdAt, updatedAt, version

### Community 19 - "Graph JSON Data 2"
Cohesion: 0.28
Nodes (7): edges, meta, prds, projects, proposals, versions, nodes

### Community 20 - "Store & Middleware Refs"
Cohesion: 0.25
Nodes (8): lib/api-fetch.js (Fetch Wrapper), lib/prd-store.js (Redis CRUD), CLAUDE.md Project Instructions, requirePermission Middleware, Admin Panel, Granular Admin Permissions, Snapshots, Upstash Redis

### Community 21 - "Seed Tasks Script"
Cohesion: 0.29
Nodes (5): dir, fs, outPath, path, tasks

### Community 22 - "Superadmin Index API"
Cohesion: 0.38
Nodes (5): { ALL_PERMISSIONS }, getKv(), handler(), { logAudit }, { Redis }

### Community 23 - "Project Meta"
Cohesion: 0.53
Nodes (4): createdAt, description, id, name

### Community 24 - "Project Meta 2"
Cohesion: 0.53
Nodes (4): createdAt, description, id, name

### Community 25 - "Legacy PRD Graph Gen"
Cohesion: 0.73
Nodes (4): load_legacy_prds(), load_projects(), main(), parse_frontmatter()

### Community 26 - "Named Resource API"
Cohesion: 0.40
Nodes (5): { ALL_PERMISSIONS }, getKv(), handler(), { logAudit }, { Redis }

### Community 27 - "PRD Save & Webhook"
Cohesion: 0.50
Nodes (3): handler(), handler(), GitHub REST API

### Community 28 - "AST Artifact"
Cohesion: 0.40
Nodes (4): edges, input_tokens, nodes, output_tokens

### Community 29 - "Redis Migration"
Cohesion: 0.40
Nodes (3): NEW, OLD, { Redis }

### Community 30 - "Version JSON"
Cohesion: 0.50
Nodes (3): content, createdAt, version

### Community 31 - "Project Config"
Cohesion: 0.50
Nodes (3): orgId, projectId, projectName

### Community 33 - "Vercel Deploy Config"
Cohesion: 0.67
Nodes (3): Vercel Deployment, project.json (Vercel Link), .vercel Folder

## Knowledge Gaps
- **220 isolated node(s):** `nodes`, `edges`, `input_tokens`, `output_tokens`, `code` (+215 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Dashboard API Handler` connect `REST API Endpoints` to `API Handlers & Audit`, `Sprint Store`, `PRD Store (Redis CRUD)`, `Snapshot & Audit Store`?**
  _High betweenness centrality (0.233) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Editor, Nav & Admin UI` to `API Handlers & Audit`, `Calendar View & Task Forms`, `Snapshot & Audit Store`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **Why does `Vercel KV (Redis-backed store)` connect `REST API Endpoints` to `Package Dependencies`, `Product Concepts & Integrations`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `nodes`, `edges`, `input_tokens` to the rest of the system?**
  _233 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Handlers & Audit` be split into smaller, more focused modules?**
  _Cohesion score 0.062173458725182866 - nodes in this community are weakly interconnected._
- **Should `REST API Endpoints` be split into smaller, more focused modules?**
  _Cohesion score 0.05084745762711865 - nodes in this community are weakly interconnected._
- **Should `Calendar View & Task Forms` be split into smaller, more focused modules?**
  _Cohesion score 0.05747126436781609 - nodes in this community are weakly interconnected._