# Graph Report - .  (2026-06-25)

## Corpus Check
- 89 files · ~51,382 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 693 nodes · 1265 edges · 47 communities (39 shown, 8 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]

## God Nodes (most connected - your core abstractions)
1. `logAudit()` - 42 edges
2. `apiFetch()` - 27 edges
3. `requireProjectAccess()` - 26 edges
4. `getKv()` - 20 edges
5. `handler()` - 19 edges
6. `Audit Log (getAuditLogs)` - 18 edges
7. `Dashboard API Handler` - 18 edges
8. `getProject()` - 16 edges
9. `listTasks()` - 16 edges
10. `PRD Knowledge Graph Viewer` - 16 edges

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

## Communities (47 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (83): getKv(), handler(), { logAudit }, { Redis }, getKv(), handler(), { logAudit }, { Redis } (+75 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (59): Assignees API (list/create), Assignee API (delete/update by name), Audit API (list/clear), Auth Login API, Auth Logout API, Dashboard API Handler, Diff API Endpoint, Project API Endpoint (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (43): bumpVersion(), createLabel(), createProject(), createProposal(), createVersion(), deleteLabel(), deleteProject(), deleteProposal() (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (31): lib/api-fetch.js (Fetch Wrapper), buildTree() Client-Side Hierarchy, Project Entity, Proposal Entity, Sprint Entity, Task Entity, Version Entity, lib/prd-store.js (Redis CRUD) (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (22): { ALL_PERMISSIONS }, getKv(), handler(), { logAudit }, { Redis }, additionalDirectories, allow, ALL_PERMISSIONS (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (29): { getAuditLogs }, getKv(), { getSprints }, handler(), { kv }, { listProjects, listProposals }, { Redis }, deleteSprint() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (33): KanbanBoard Component, TaskTree Component, Agora Integration (Audio/Video Calls), CometChat Integration (Chat), Commission Cascade (boostâ†’per-astrologerâ†’systemâ†’fallback), Consultation State Machine (PENDINGâ†’ACCEPTEDâ†’CONFIRMEDâ†’COMPLETED), GitHub as Database (No Traditional DB), Graphify Graph Engine (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (30): Admin Panel, API-004, Authentication System, Login, Mobile App, Platform Team, Single Sign-On (SSO), Token Management (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (23): { addNotification }, handler(), { listProjects }, { listTasks }, addNotification(), getKv(), key(), listNotifications() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (16): Editor(), renderMarkdown(), apiFetch(), apiFetchOrLogout(), Home(), [assignees, setAssignees], handleDeleteProposal(), handleNewProposal() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (21): COL_COLORS, Kanban Column localStorage Persistence, COLUMNS, DEFAULT_COLUMNS, formatDate(), isOverdue(), Kanban Label CRUD (labels API), parseMentions() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (16): AssigneeInput Component, DayTaskForm(), postComment (task updates), AVATAR_THEMES, blankForm(), getDescendantStats(), TaskNode handleAddUpdate (updates), PRIORITY_COLOR (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (17): { kv }, createSnapshot(), deleteSnapshot(), getKv(), getSnapshot(), { kv }, { listProjects, getProject }, listSnapshots() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): dependencies, diff, dotenv, next, react, react-dom, remark, @upstash/redis (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (14): edges, meta, prds, projects, proposals, versions, nodes, edges (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (14): Task API Handler ([taskId].js), Full-State Snapshot Capture, Vercel KV Store, deleteTask Function, getTask Function, logAudit Function, reorderTask Function, requireAdmin Function (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.26
Nodes (10): blankForm(), dueKey(), MONTHS, PRIORITY_COLOR, reschedule (set dueDate via drag), CalendarView saveTask, STATUSES, WEEKDAYS (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (8): daysLeft(), formatSprintDate(), SprintChips(), SprintProgressBar(), SprintsSection(), SprintTaskChip(), TaskSkeleton(), TasksPage()

### Community 20 - "Community 20"
Cohesion: 0.24
Nodes (7): content, createdAt, version, content, createdAt, updatedAt, version

### Community 21 - "Community 21"
Cohesion: 0.28
Nodes (7): edges, meta, prds, projects, proposals, versions, nodes

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (5): dir, fs, outPath, path, tasks

### Community 23 - "Community 23"
Cohesion: 0.53
Nodes (4): createdAt, description, id, name

### Community 24 - "Community 24"
Cohesion: 0.53
Nodes (4): createdAt, description, id, name

### Community 26 - "Community 26"
Cohesion: 0.73
Nodes (4): load_legacy_prds(), load_projects(), main(), parse_frontmatter()

### Community 27 - "Community 27"
Cohesion: 0.50
Nodes (3): handler(), handler(), GitHub REST API

### Community 28 - "Community 28"
Cohesion: 0.40
Nodes (4): edges, input_tokens, nodes, output_tokens

### Community 29 - "Community 29"
Cohesion: 0.40
Nodes (3): NEW, OLD, { Redis }

### Community 30 - "Community 30"
Cohesion: 0.50
Nodes (3): content, createdAt, version

### Community 31 - "Community 31"
Cohesion: 0.50
Nodes (3): orgId, projectId, projectName

## Knowledge Gaps
- **222 isolated node(s):** `nodes`, `edges`, `input_tokens`, `output_tokens`, `code` (+217 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Dashboard API Handler` connect `Community 1` to `Community 0`, `Community 8`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Community 9` to `Community 0`, `Community 4`, `Community 11`, `Community 12`, `Community 13`, `Community 18`, `Community 19`, `Community 25`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Why does `Vercel KV (Redis-backed store)` connect `Community 1` to `Community 14`, `Community 6`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `nodes`, `edges`, `input_tokens` to the rest of the system?**
  _235 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05393939393939394 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05084745762711865 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08979591836734693 - nodes in this community are weakly interconnected._