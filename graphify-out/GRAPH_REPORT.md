# Graph Report - .  (2026-05-25)

## Corpus Check
- Corpus is ~47,290 words - fits in a single context window. You may not need a graph.

## Summary
- 480 nodes · 757 edges · 39 communities (29 shown, 10 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 88 edges (avg confidence: 0.9)
- Token cost: 11,400 input · 3,650 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Route Handlers|API Route Handlers]]
- [[_COMMUNITY_PRD Version & Proposal Flow|PRD Version & Proposal Flow]]
- [[_COMMUNITY_Auth & Assignees API Layer|Auth & Assignees API Layer]]
- [[_COMMUNITY_Dashboard Data Pipeline|Dashboard Data Pipeline]]
- [[_COMMUNITY_Task UI & Sanatan Platform|Task UI & Sanatan Platform]]
- [[_COMMUNITY_Platform Auth & Admin|Platform Auth & Admin]]
- [[_COMMUNITY_Dashboard UI Panels|Dashboard UI Panels]]
- [[_COMMUNITY_Project REST Endpoints|Project REST Endpoints]]
- [[_COMMUNITY_Graph & PRD Data Store|Graph & PRD Data Store]]
- [[_COMMUNITY_Package Configuration|Package Configuration]]
- [[_COMMUNITY_Task & Snapshot Storage|Task & Snapshot Storage]]
- [[_COMMUNITY_Graphify Detection Output|Graphify Detection Output]]
- [[_COMMUNITY_Project Page & Fetch Layer|Project Page & Fetch Layer]]
- [[_COMMUNITY_Task UI Internals|Task UI Internals]]
- [[_COMMUNITY_Navigation & Editor UI|Navigation & Editor UI]]
- [[_COMMUNITY_Admin & Audit UI|Admin & Audit UI]]
- [[_COMMUNITY_Sprint Task View|Sprint Task View]]
- [[_COMMUNITY_Kanban Board Logic|Kanban Board Logic]]
- [[_COMMUNITY_Snapshot Store|Snapshot Store]]
- [[_COMMUNITY_Task Seeding Script|Task Seeding Script]]
- [[_COMMUNITY_Project Metadata Schema|Project Metadata Schema]]
- [[_COMMUNITY_GitHub Webhook Integration|GitHub Webhook Integration]]
- [[_COMMUNITY_Diff Viewer Component|Diff Viewer Component]]
- [[_COMMUNITY_Graphify AST Output|Graphify AST Output]]
- [[_COMMUNITY_PRD Version JSON Schema|PRD Version JSON Schema]]
- [[_COMMUNITY_PRD Metadata Schema|PRD Metadata Schema]]
- [[_COMMUNITY_Graph Generation Scripts|Graph Generation Scripts]]
- [[_COMMUNITY_Claude Settings Config|Claude Settings Config]]
- [[_COMMUNITY_PRD Content Schema|PRD Content Schema]]
- [[_COMMUNITY_Markdown Editor|Markdown Editor]]
- [[_COMMUNITY_Diff Library Binding|Diff Library Binding]]
- [[_COMMUNITY_Next.js Configuration|Next.js Configuration]]
- [[_COMMUNITY_Next.js Config Node|Next.js Config Node]]
- [[_COMMUNITY_Package Root|Package Root]]
- [[_COMMUNITY_Editor README|Editor README]]
- [[_COMMUNITY_Python Dependency|Python Dependency]]

## God Nodes (most connected - your core abstractions)
1. `logAudit()` - 35 edges
2. `Audit Log (getAuditLogs)` - 19 edges
3. `PRD Knowledge Graph Viewer` - 16 edges
4. `apiFetch()` - 15 edges
5. `requireAdmin()` - 14 edges
6. `listTasks()` - 12 edges
7. `Vercel KV (Redis-backed store)` - 11 edges
8. `Authentication System` - 11 edges
9. `PRD Store (listProjects, listProposals)` - 10 edges
10. `Dashboard API Handler` - 10 edges

## Surprising Connections (you probably didn't know these)
- `getTasksForProject()` --semantically_similar_to--> `listTasks()`  [INFERRED] [semantically similar]
  pages/api/dashboard/index.js → lib/task-store.js
- `refreshProjectStats()` --semantically_similar_to--> `Dashboard Data Aggregation`  [INFERRED] [semantically similar]
  lib/prd-store.js → pages/api/dashboard/index.js
- `GitHub as Database (No Traditional DB)` --conceptually_related_to--> `Vercel KV (Redis-backed store)`  [INFERRED]
  PRD.md → pages/api/dashboard/index.js
- `DiffViewer()` --references--> `PRD Version Management`  [INFERRED]
  components/DiffViewer.js → lib/prd-store.js
- `PRD Manager README` --references--> `Vercel KV (Redis-backed store)`  [EXTRACTED]
  README.md → pages/api/dashboard/index.js

## Hyperedges (group relationships)
- **GitHub Integration** — api_save_prd_handler, api_webhook_handler, ext_github_api [EXTRACTED 1.00]
- **Task Management UI Components** — components_tasktree, components_kanbanboard, lib_taskstore, lib_apifetch [INFERRED 0.95]
- **Admin Panel Feature Set** — pages_admin, lib_auditlog, lib_snapshotstore, lib_requireadmin, components_nav [INFERRED 0.95]
- **Authentication flow: login screen, API, localStorage persistence** — pages_app, api_auth_login, api_auth_logout, api_assignees_index, vercel_kv, lib_audit_log [EXTRACTED 1.00]
- **Dashboard Data Aggregation Pipeline** — dashboard_api_handler, lib_prd_store, lib_sprint_store, lib_audit_log [INFERRED 0.90]
- **Dashboard Metrics (Overdue, Workload, Velocity, Sprints)** — dashboard_overdue_logic, dashboard_workload_logic, dashboard_velocity_logic, dashboard_active_sprints [INFERRED 0.85]
- **Dashboard aggregates tasks, proposals, sprints, and audit velocity** — api_dashboard_index, api_dashboard_getTasksForProject, lib_prd_store, lib_task_store, lib_sprint_store, lib_audit_log, vercel_kv [EXTRACTED 1.00]
- **Task CRUD Operations (GET/PUT/DELETE/PATCH)** — api_taskid_handler, func_gettask, func_updatetask, func_deletetask, func_reordertask, lib_taskstore, lib_auditlog [EXTRACTED 1.00]
- **Diff View System (version vs proposal comparison)** — page_diff, api_diff_endpoint, component_diffviewer, concept_diff_comparison [EXTRACTED 1.00]
- **Proposal Workflow (createâ†’promoteâ†’version)** — page_project_index, api_proposals_endpoint, api_promote_endpoint, concept_proposal_promote [EXTRACTED 1.00]
- **Sprint Management System** — comp_sprintssection, api_sprint_endpoint, concept_sprint_lifecycle, page_tasks [EXTRACTED 1.00]
- **Sanatan Sansaar Backend Domain Cluster** — domain_sanatan_backend, concept_consultation_state_machine, concept_agora_integration, concept_cometchat_integration, concept_wallet_billing, concept_commission_cascade [INFERRED 0.85]
- **Graph Generation Pipeline** — script_generate_graph, prd_aipm_meta, prd_sanatan_meta, output_graph_json, output_public_graphify [EXTRACTED 1.00]
- **KV Data Seeding Pipeline** — script_seed_kv, script_seed_tasks, prd_sanatan_tasks, vercel_kv, kv_key_pattern [EXTRACTED 1.00]
- **ProductGraph OS Core Concepts** — concept_productgraph_os, concept_git_as_database, concept_graphify_engine, concept_prd_frontmatter, doc_prd_md, doc_github_schema [EXTRACTED 0.95]
- **Authentication System Dependencies** — auth001_authentication_system, user001_user_profile_service, auth001_api004 [EXTRACTED 1.00]
- **Apps Affected by Authentication System** — auth001_authentication_system, auth001_mobile_app, auth001_admin_panel [EXTRACTED 1.00]
- **Apps Affected by User Profile Service** — user001_user_profile_service, auth001_mobile_app, user001_web_portal [EXTRACTED 1.00]
- **PRD Knowledge Graph UI Components** — public_graphify_html_prd_knowledge_graph, public_graphify_html_sidebar, public_graphify_html_legend, public_graphify_html_detail_panel, public_graphify_html_stats, public_graphify_html_controls [EXTRACTED 1.00]
- **PRD Knowledge Graph Node Types** — public_graphify_html_node_type_project, public_graphify_html_node_type_version, public_graphify_html_node_type_proposal, public_graphify_html_node_type_prd [EXTRACTED 1.00]
- **PRD Knowledge Graph Edge Types** — public_graphify_html_edge_type_has_version, public_graphify_html_edge_type_has_proposal, public_graphify_html_edge_type_promoted_to, public_graphify_html_edge_type_depends_on [EXTRACTED 1.00]
- **All Write API Handlers Emit Audit Logs via logAudit** — projects_index_handler, proposals_index_handler, versions_index_handler, pages_api_projects_slug_tasks_index_js_tasks_index_handler, lib_audit_log_logaudit [INFERRED 0.85]
- **Dashboard Handler Aggregates Tasks Proposals Sprints and Audit Logs** — prd_manager_dashboard_handler, lib_prd_store_listprojects, lib_prd_store_listproposals, lib_sprint_store_getsprints, lib_audit_log_getauditlogs, prd_manager_gettasksforproject [EXTRACTED 0.95]
- **Proposal Creation to Promotion to Version Bump Flow** — lib_prd_store_createproposal, lib_prd_store_promoteproposal, lib_prd_store_createversion, lib_prd_store_bumpversion [INFERRED 0.85]
- **All mutating API handlers log to audit trail** — api_auth_login, api_auth_logout, api_assignees_index, api_assignees_name, api_projects_index, api_projects_slug, api_projects_slug_proposals_index, api_projects_slug_proposals_id, api_projects_slug_proposals_id_promote, api_projects_slug_tasks_index, api_projects_slug_tasks_taskId, api_projects_slug_versions_index, api_projects_slug_versions_version, api_projects_slug_versions_version_tasks_index, lib_audit_log [EXTRACTED 1.00]
- **Admin-only destructive operations require requireAdmin middleware** — api_assignees_name, api_audit_index, api_projects_slug, api_projects_slug_proposals_id, api_projects_slug_tasks_taskId, lib_require_admin [EXTRACTED 1.00]
- **Dashboard aggregates tasks, proposals, sprints, and audit velocity** — api_dashboard_index, api_dashboard_getTasksForProject, lib_prd_store, lib_task_store, lib_sprint_store, lib_audit_log, vercel_kv [EXTRACTED 1.00]
- **Authentication flow: login screen, API, localStorage persistence** — pages_app, api_auth_login, api_auth_logout, api_assignees_index, vercel_kv, lib_audit_log [EXTRACTED 1.00]
- **All top-level UI pages render the Nav component** — pages_dashboard, pages_editor, pages_index, component_nav [EXTRACTED 1.00]
- **Proposal lifecycle: create, update, delete, promote to version** — api_projects_slug_proposals_index, api_projects_slug_proposals_id, api_projects_slug_proposals_id_promote, lib_prd_store, api_projects_slug_versions_index [INFERRED 0.95]
- **Task CRUD Operations (GET/PUT/DELETE/PATCH)** — api_taskid_handler, func_gettask, func_updatetask, func_deletetask, func_reordertask, lib_taskstore, lib_auditlog [EXTRACTED 1.00]
- **Diff View System (version vs proposal comparison)** — page_diff, api_diff_endpoint, component_diffviewer, concept_diff_comparison [EXTRACTED 1.00]
- **Sprint Management System** — comp_sprintssection, api_sprint_endpoint, concept_sprint_lifecycle, page_tasks [EXTRACTED 1.00]
- **Proposal Workflow (createâ†’promoteâ†’version)** — page_project_index, api_proposals_endpoint, api_promote_endpoint, concept_proposal_promote [EXTRACTED 1.00]
- **Sanatan Sansaar Backend Domain Cluster** — domain_sanatan_backend, concept_consultation_state_machine, concept_agora_integration, concept_cometchat_integration, concept_wallet_billing, concept_commission_cascade [INFERRED 0.85]
- **KV Data Seeding Pipeline** — script_seed_kv, script_seed_tasks, prd_sanatan_tasks, vercel_kv, kv_key_pattern [EXTRACTED 1.00]
- **Graph Generation Pipeline** — script_generate_graph, prd_aipm_meta, prd_sanatan_meta, output_graph_json, output_public_graphify [EXTRACTED 1.00]
- **ProductGraph OS Core Concepts** — concept_productgraph_os, concept_git_as_database, concept_graphify_engine, concept_prd_frontmatter, doc_prd_md, doc_github_schema [EXTRACTED 0.95]
- **Authentication System Dependencies** — auth001_authentication_system, user001_user_profile_service, auth001_api004 [EXTRACTED 1.00]
- **Apps Affected by Authentication System** — auth001_authentication_system, auth001_mobile_app, auth001_admin_panel [EXTRACTED 1.00]
- **Apps Affected by User Profile Service** — user001_user_profile_service, auth001_mobile_app, user001_web_portal [EXTRACTED 1.00]
- **PRD Knowledge Graph UI Components** — public_graphify_html_prd_knowledge_graph, public_graphify_html_sidebar, public_graphify_html_legend, public_graphify_html_detail_panel, public_graphify_html_stats, public_graphify_html_controls [EXTRACTED 1.00]
- **PRD Knowledge Graph Node Types** — public_graphify_html_node_type_project, public_graphify_html_node_type_version, public_graphify_html_node_type_proposal, public_graphify_html_node_type_prd [EXTRACTED 1.00]
- **PRD Knowledge Graph Edge Types** — public_graphify_html_edge_type_has_version, public_graphify_html_edge_type_has_proposal, public_graphify_html_edge_type_promoted_to, public_graphify_html_edge_type_depends_on [EXTRACTED 1.00]

## Communities (39 total, 10 thin omitted)

### Community 0 - "API Route Handlers"
Cohesion: 0.09
Nodes (42): handler(), handler(), handler(), handler(), handler(), clearAuditLogs(), getAuditLogs(), getAuditUser() (+34 more)

### Community 1 - "PRD Version & Proposal Flow"
Cohesion: 0.09
Nodes (37): handler(), { logAudit }, { promoteProposal }, bumpVersion(), createProposal(), createVersion(), deleteProposal(), getProject() (+29 more)

### Community 2 - "Auth & Assignees API Layer"
Cohesion: 0.09
Nodes (39): Assignees API (list/create), Assignee API (delete/update by name), Audit API (list/clear), Auth Login API, Auth Logout API, getTasksForProject (dashboard helper), Dashboard API Handler, Projects List/Create API Handler (+31 more)

### Community 3 - "Dashboard Data Pipeline"
Cohesion: 0.09
Nodes (31): { getAuditLogs }, { getSprints }, handler(), { kv }, { listProjects, listProposals }, { kv }, createProject(), listProjects() (+23 more)

### Community 4 - "Task UI & Sanatan Platform"
Cohesion: 0.09
Nodes (33): KanbanBoard Component, TaskTree Component, Agora Integration (Audio/Video Calls), CometChat Integration (Chat), Commission Cascade (boostâ†’per-astrologerâ†’systemâ†’fallback), Consultation State Machine (PENDINGâ†’ACCEPTEDâ†’CONFIRMEDâ†’COMPLETED), GitHub as Database (No Traditional DB), Graphify Graph Engine (+25 more)

### Community 5 - "Platform Auth & Admin"
Cohesion: 0.09
Nodes (31): Admin Panel, API-004, Authentication System, Login, Mobile App, Platform Team, Single Sign-On (SSO), Token Management (+23 more)

### Community 6 - "Dashboard UI Panels"
Cohesion: 0.08
Nodes (4): ACTION_LABELS, Dashboard(), timeAgo(), Dashboard Data Aggregation

### Community 7 - "Project REST Endpoints"
Cohesion: 0.11
Nodes (21): Diff API Endpoint, Project API Endpoint, Proposal Promote API Endpoint, Proposals API Endpoint, Sprint API Endpoint, Tasks API Endpoint, SprintsSection Component, DiffViewer Component (+13 more)

### Community 8 - "Graph & PRD Data Store"
Cohesion: 0.12
Nodes (14): edges, meta, prds, projects, proposals, versions, nodes, edges (+6 more)

### Community 9 - "Package Configuration"
Cohesion: 0.12
Nodes (15): dependencies, diff, dotenv, next, react, react-dom, remark, @vercel/kv (+7 more)

### Community 10 - "Task & Snapshot Storage"
Cohesion: 0.22
Nodes (14): Task API Handler ([taskId].js), Full-State Snapshot Capture, Vercel KV Store, deleteTask Function, getTask Function, logAudit Function, reorderTask Function, requireAdmin Function (+6 more)

### Community 11 - "Graphify Detection Output"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 12 - "Project Page & Fetch Layer"
Cohesion: 0.19
Nodes (12): apiFetch(), [assignees, setAssignees], handleDeleteProposal(), handleNewProposal(), handlePromote(), [loading, setLoading], pendingProposals, [project, setProject] (+4 more)

### Community 13 - "Task UI Internals"
Cohesion: 0.20
Nodes (10): KanbanBoard(), blankForm(), buildTree(), PRIORITY_COLOR, PRIORITY_LABEL, STATUS_CYCLE, STATUS_LABEL, TaskForm() (+2 more)

### Community 15 - "Admin & Audit UI"
Cohesion: 0.22
Nodes (7): createSnapshot(), ACTION_LABELS, AdminPage(), AuditLog(), Snapshots(), UserRow(), Audit Trail Pattern

### Community 17 - "Kanban Board Logic"
Cohesion: 0.29
Nodes (3): COLUMNS, PRIORITY_COLOR, PRIORITY_LABEL

### Community 18 - "Snapshot Store"
Cohesion: 0.29
Nodes (3): { kv }, { listProjects, getProject }, { listTasks }

### Community 19 - "Task Seeding Script"
Cohesion: 0.29
Nodes (5): dir, fs, outPath, path, tasks

### Community 20 - "Project Metadata Schema"
Cohesion: 0.40
Nodes (4): createdAt, description, id, name

### Community 21 - "GitHub Webhook Integration"
Cohesion: 0.50
Nodes (3): handler(), handler(), GitHub REST API

### Community 23 - "Graphify AST Output"
Cohesion: 0.40
Nodes (4): edges, input_tokens, nodes, output_tokens

### Community 24 - "PRD Version JSON Schema"
Cohesion: 0.40
Nodes (4): content, createdAt, version, updatedAt

### Community 25 - "PRD Metadata Schema"
Cohesion: 0.40
Nodes (4): createdAt, description, id, name

### Community 26 - "Graph Generation Scripts"
Cohesion: 0.70
Nodes (4): load_legacy_prds(), load_projects(), main(), parse_frontmatter()

### Community 27 - "Claude Settings Config"
Cohesion: 0.50
Nodes (3): permissions, additionalDirectories, allow

### Community 28 - "PRD Content Schema"
Cohesion: 0.50
Nodes (3): content, createdAt, version

## Knowledge Gaps
- **167 isolated node(s):** `nodes`, `edges`, `input_tokens`, `output_tokens`, `code` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logAudit()` connect `API Route Handlers` to `PRD Version & Proposal Flow`, `Dashboard Data Pipeline`, `Admin & Audit UI`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Project Page & Fetch Layer` to `Task UI Internals`, `Navigation & Editor UI`, `Admin & Audit UI`, `Kanban Board Logic`, `Markdown Editor`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `Audit Trail Pattern` connect `Admin & Audit UI` to `API Route Handlers`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `nodes`, `edges`, `input_tokens` to the rest of the system?**
  _179 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Route Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.09225589225589226 - nodes in this community are weakly interconnected._
- **Should `PRD Version & Proposal Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.08879492600422834 - nodes in this community are weakly interconnected._
- **Should `Auth & Assignees API Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.08906882591093117 - nodes in this community are weakly interconnected._