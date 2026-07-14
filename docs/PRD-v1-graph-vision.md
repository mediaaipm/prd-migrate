> **ARCHIVED — NOT THE CURRENT SPEC.**
>
> This is the original v1 vision (May 2025): a Git-native, database-less PRD system
> backed by GitHub commits and rendered as a Graphify knowledge graph.
>
> **That is not what was built.** The shipped product is a Redis-backed PRD + task
> management tool. No GitHub sync engine exists; GitHub is not the source of truth;
> there is no graph visualization UI.
>
> Kept because the graph/impact-analysis direction is still a plausible future phase.
> For the current spec see [PRD.md](../PRD.md).

---

PRD — ProductGraph OS (Working Name)
Version
1.0.0 (MVP)

1. Product Overview
1.1 Summary
ProductGraph OS is a Git-based, graph-powered product intelligence system that converts PRDs, features, releases, and architectural decisions into a queryable knowledge graph.
It uses:


GitHub as the database (source of truth)


Graphify as the graph engine


Vercel as the web platform


Markdown/YAML as the data format


No traditional database is required in MVP.

1.2 Vision
To replace fragmented PRDs, roadmaps, and documentation systems with a single connected product intelligence graph that enables:


dependency tracking


version lineage


impact analysis


cross-product visibility


AI-ready structured knowledge



1.3 Problem Statement
Modern product organizations face:


PRDs stored in isolation


no visibility into dependencies


duplicated features across teams


unclear ownership of systems


no version lineage tracking


difficulty understanding impact of changes


As a result:


decisions are slow


systems break unexpectedly


knowledge is lost across teams



1.4 Goals


Build a Git-native PRD system


Create automatic graph relationships


Enable multi-product dependency tracking


Support versioning of all PRDs


Provide interactive graph visualization


Enable impact analysis queries



1.5 Non-Goals (MVP)


Real-time collaboration (like Notion)


Full enterprise RBAC system


Large-scale analytics dashboards


Vector search / AI embeddings


Multi-cloud deployment



2. Target Users
Primary Users


Product Managers → PRDs, roadmap, dependencies


Engineers → APIs, architecture, ownership


Tech Leads → system dependencies


Leadership → product visibility


Secondary Users


QA teams → release tracking


Designers → feature relationships


AI agents → graph querying



3. Core System Design
3.1 High-Level Architecture
Frontend (Next.js on Vercel)        ↓GitHub Repo (Source of Truth)        ↓Markdown + YAML PRDs        ↓Graphify Engine        ↓graph.json + graph.html        ↓Graph UI (Vercel)

3.2 Data Storage (No Database)
System uses:


GitHub repositories (primary storage)


Markdown files (PRDs, docs)


YAML frontmatter (metadata)


Graphify output (graph.json)



3.3 Graph Model
Node Types


Product


Feature


PRD


API


Release


Decision


Team



Relationship Types


depends_on


affects


owned_by


integrates_with


supersedes


contains


blocks



4. Core Features

4.1 PRD Management System
Description
Users can create and edit PRDs in browser.
Requirements


Markdown-based editor


YAML metadata support


Version tagging (1.0.0, 1.0.1)


Save commits to GitHub


PRD linking support


Example PRD format
id: AUTH-001title: Authentication Systemversion: 1.0.0owner: platform-teamdepends_on:  - USER-001  - API-004affects:  - mobile-app  - admin-panel

4.2 GitHub Sync Engine
Description
All edits persist via GitHub commits.
Flow
User edits PRD→ API route on Vercel→ GitHub API commit→ Repo updated→ Graphify rebuild triggered

4.3 Graph Generation Engine
Description
Graphify converts repo into graph.
Output:


graph.json (data)


graph.html (visualization)


GRAPH_REPORT.md (summary insights)


Trigger:


manual refresh OR


GitHub webhook



4.4 Dependency Mapping
Description
System automatically builds:


product dependencies


feature dependencies


API usage graph


release lineage


Output Example
Auth System → depends_on → User ServiceCheckout → depends_on → Billing APIMobile App → uses → Auth System

4.5 Versioning System
Rules


Semantic versioning for all PRDs


Git commits maintain history


Graph links versions via:


supersedes


replaces


evolves_into





4.6 Graph Visualization UI
Features


interactive node graph


filter by product / team


search PRDs


view dependencies


trace impact paths



4.7 Impact Analysis Engine
Queries supported:


What breaks if API-004 changes?


Which products depend on AUTH-001?


What releases included billing updates?



4.8 Decision Log System
Tracks architectural decisions:


decision ID


reason


impact


affected systems



5. User Experience Flow
5.1 Creating a PRD
Open UI→ Click "New PRD"→ Fill form or markdown editor→ Save→ GitHub commit created→ Graph updates automatically

5.2 Updating PRD
Open PRD→ Edit version or dependencies→ Save→ Commit new version→ Graph updates lineage

5.3 Viewing Graph
Open dashboard→ Graph loads from graph.json→ User explores dependencies→ Click node → view PRD

6. System Requirements
6.1 Performance


Graph load < 2s for MVP


GitHub API latency handled via caching


6.2 Scalability


Supports multiple repos


Supports multi-product graphs


6.3 Reliability


GitHub as single source of truth


No data loss possible (commit history)



7. Tech Stack
Frontend


Next.js


React


Tailwind


Backend


Vercel Serverless Functions


GitHub API


Graph Engine


Graphify


Storage


GitHub repository



8. Data Model
PRD Entity
idtitleversionstatusownerdepends_on[]affects[]content
Graph Node
idtypelabelmetadataedges[]

9. MVP Scope
Included


PRD editor


GitHub sync


Graphify integration


graph visualization


dependency tracking


versioning system


Excluded


real-time collaboration


AI inference layer


vector search


enterprise permissions



10. Future Enhancements
Phase 2


AI PRD summarization


duplicate feature detection


semantic search


Slack integration


Phase 3


Jira sync


Figma integration


incident graphing


predictive impact analysis



11. Risks
RiskMitigationGitHub API limitscaching + batchinggraph complexityclusteringinconsistent metadataschema validationlarge reposincremental graph updates

12. Success Metrics


% PRDs linked in graph


dependency coverage ratio


time to understand impact


reduction in duplicate features


adoption across teams



13. Key Insight
This system is not a documentation tool.
It is a:
Product Intelligence Graph Layer
powered by:


Git (truth layer)


Graphify (structure layer)


Vercel (interface layer)



If you want next step, I can help you design:


database-less GitHub schema (perfect folder + naming system)


Vercel architecture (API routes + flows)


UI wireframe for PRD editor + graph dashboard


or MVP build plan (1–2 week execution roadmap)

