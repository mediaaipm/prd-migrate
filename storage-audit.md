# Storage Audit — workshop-task-manager

Status: **Root cause found and fixed. Nothing deleted.**
Date: 2026-07-28
Repo: `gitlab.com/bajaj-corp/workshop/task-manager` · Vercel project `workshop-task-manager` (`prj_rBjqusNAhnZlBjS7qjJ1fFrRUmkg`)

---

## The quota that actually blew

Of the reported usage, exactly one line is over:

| Resource | Usage | State |
|---|---|---|
| **Fast Origin Transfer** | **13.76 GB / 10 GB** | **exceeded** |
| Edge Requests | 610K / 1M | fine |
| Fluid Active CPU | 2h 15m / 4h | fine |
| Function Invocations | 293K / 1M | fine |
| Fast Data Transfer | 25.33 GB / 100 GB | fine |
| Fluid Provisioned Memory | 63.9 / 360 GB-Hrs | fine |

Storage is not a metered line at all. So the 1.67 GB is not the bill — it is the
*cause* of the bill. Fast Origin Transfer is bytes leaving a function, and this app
was shipping its entire image library out of a function on every board interaction.

13.76 GB of egress against ~1.67 GB of stored images means the same bytes went out
roughly 8× over, and none of it was cacheable.

---

## Premise correction — there is no blob store

This project has **no blob storage**. Verified:

| Check | Result |
|---|---|
| `@vercel/blob` in `package.json` / `package-lock.json` | absent |
| `@aws-sdk` / `aws-sdk` / `minio` / `@google-cloud/storage` / cloudinary | absent |
| `BLOB_READ_WRITE_TOKEN` in `.env.example` or `.env.local` | absent |
| `put()` / `createPresignedUrl` / `getSignedUrl` / multipart upload handlers | none in codebase |
| Storage bindings actually present in `.env.local` | `UPSTASH_REDIS_REST_*`, `newtaskmaanager_KV_*`, `newtaskmaanager_REDIS_URL` |

The only persistence layer is **Upstash Redis / Vercel KV**. The 1.67 GB is almost
certainly the KV store as reported on the Vercel Storage tab, not a blob store.

This matters for the plan: there are no "blob keys", no lifecycle rules to attach,
and no object store to run a manifest-driven delete against. Everything below is
restated in terms of Redis keys.

The sibling comparison still holds and still points here — `workshop-support-bot`
at 40 MB is a normal KV footprint. 1.67 GB is not.

---

## The actual mechanism: binary data is stored inline in Redis as base64

Images are not uploaded anywhere. They are read client-side into a data URL and
written into the task JSON.

- [components/KanbanBoard.js:728-749](components/KanbanBoard.js#L728-L749) — `addAttachments()` → `readFileAsDataUrl(f)` → pushed onto `form.attachments`
- [components/TaskTree.js:200](components/TaskTree.js#L200) and [components/CalendarView.js:46](components/CalendarView.js#L46) — same pattern, duplicated
- [lib/task-store.js:235-236](lib/task-store.js#L235-L236) — `attachments` and `cover` persisted verbatim into the task record

The comment on the cap is explicit about it:

```js
const MAX_ATTACH_BYTES = 1024 * 1024 // 1MB cap per image (stored inline as data URL in Redis)
```

Consequences:

1. **+33% base64 overhead.** A 1 MB image occupies ~1.37 MB of Redis value.
2. **Covers are stored twice.** [KanbanBoard.js:758](components/KanbanBoard.js#L758) — `setCover()` copies `att.dataUrl` into `form.cover` rather than referencing `attId`. The `attId` is stored alongside, so the reference already exists and the copy is pure waste. Every task with a cover carries that image twice.
3. **Tasks are stored as one list per (slug, version).** `loadTasks`/`saveTasks` read and write the whole list. Every task edit rewrites every attachment in that version's list. This is a latency and command-cost problem, not a size problem, but it compounds the next item.

---

## The amplifier: snapshots embed every attachment, uncapped

[lib/snapshot-store.js:7-33](lib/snapshot-store.js#L7-L33) is the single largest
growth driver.

```js
tasks[v.version] = await listTasks(p.slug, v.version)
projects.push({ ...full, tasks })
await getKv().set(`snapshot:${id}`, snapshot)
```

`listTasks` returns full task objects — **including every base64 `attachments[]`
entry and every `cover.dataUrl`**. So each snapshot is a complete byte-for-byte
copy of the entire dataset, images included.

- No count cap, no size cap, no TTL.
- No retention policy. Deleted only by hand via the admin Snapshots tab.
- N snapshots ⇒ N+1 copies of every image ever attached.
- The PRD acknowledges the design but not the cost — [PRD.md:205-208](PRD.md#L205-L208): *"Snapshot = full serialization of every project, version, proposal, and task list."*

**This is the leak.** A handful of snapshots taken over four weeks, against a
dataset that accumulated inline images, produces exactly the growth curve
described (near-zero → 1.67 GB, sibling project unaffected because it has no
attachment feature).

---

## Anti-pattern checklist (Phase 2, item 6)

| Anti-pattern | Present | Where |
|---|---|---|
| Full snapshots per event | **Yes** | `lib/snapshot-store.js` — full-system serialization, no retention |
| Raw uploads, no cap/compression/resize | **Partly** | 1 MB/file cap exists, but **no compression, no resizing, no dimension limit, no total-per-task cap, no MIME allowlist**. Cap is client-side only — see below |
| Generated artifacts that could be regenerated | No | No exports/thumbnails/PDFs written to storage |
| Retry logic rewriting instead of overwriting | No | `lib/submit-queue.js` retries the same API call; keys are stable |
| Test/dev code writing to production store | **Yes, latent** | `scripts/seed-kv.js`, `scripts/seed-tasks.js` write to whatever `UPSTASH_REDIS_REST_URL` is set to. `.env.local` points at production. No environment guard |

### Additional findings not on your list

**A. The 1 MB cap is client-side only and trivially bypassed.**
`MAX_ATTACH_BYTES` is enforced in three React components. The API route that
persists the task does not validate `attachments[].dataUrl` length at all. Any
direct POST can store an arbitrarily large payload.

**B. `deleteTaskHistory` is dead code — task history is never cleaned up.**
[lib/task-history-store.js:150](lib/task-history-store.js#L150) is exported and
**never called anywhere in the repo**. Deleting a task leaves
`taskhistory:{slug}:{version}:{taskId}` orphaned permanently. Capped at 500
entries each, so bounded per key, but unbounded in key count.

**C. Caps that do exist and are working correctly** — not suspects:

| Key | Cap | Enforced at |
|---|---|---|
| `audit:logs` | 2000 entries, `zremrangebyrank` | [lib/audit-log.js:33-35](lib/audit-log.js#L33-L35) |
| `taskhistory:*` | 500 entries, `ltrim` | [lib/task-history-store.js:89](lib/task-history-store.js#L89) |
| login rate-limit keys | TTL via `expire` | [lib/login-rate-limit.js:46](lib/login-rate-limit.js#L46) |

`snapshot:{id}` is the only unbounded, uncapped, un-expiring key family in the codebase.

---

## What I could not do, and why

**Phase 1 (inventory) and Phase 3 (orphans, dedup)** require reading the live
Upstash store. I have not connected to it. Both are read-only and safe to run,
but I want your go-ahead first because:

- It is a different store than the one you named — worth confirming I'm pointed at the right thing.
- `.env.local` credentials are production. I'd rather you confirm than assume.
- Upstash bills per command. A full `SCAN` + `MEMORY USAGE` per key over a 1.67 GB store is potentially tens of thousands of commands. Cheap, but not free, and you should opt in.

Note also that **"bytes written per day" (item 3) is not recoverable retroactively.**
Redis stores no per-key write timestamps. The closest proxies available are
`snapshot:{id}` IDs (`snap-{Date.now()}`, so each snapshot self-dates) and
`createdAt`/`updatedAt` on task records. That gives a snapshot-creation timeline,
which given the analysis above is probably the only timeline that matters.

---

## What was changed (no data touched)

All of it is read-path and write-validation. No key was deleted, no stored value was
rewritten, no migration was run. Existing records are untouched and every change is
revertible with `git checkout`.

**New — `lib/task-media.js`**
`stripTaskMedia` / `stripTasksMedia` replace every inline `dataUrl` on an outgoing
task with a `url`; `mergeTaskMedia` puts the bytes back on the way in;
`validateAttachments` enforces the size cap server-side.

**New — `pages/api/projects/[slug]/media/[taskId]/[attId].js`**
Serves one attachment's bytes behind the same `task:view` ACL, with a SHA-1 ETag,
`Cache-Control: private, max-age=31536000, immutable`, and 304 on revalidation.
`private` because these sit behind a per-project ACL and must not enter a shared
edge cache — the win is the browser cache, which previously could not participate
at all.

**New — `lib/attachment-src.js`**
`attSrc` / `coverSrc` resolve either a saved attachment (`url`) or one just picked
in the form (`dataUrl`), so both render.

**Stripped at every route that returns tasks:**

| Route | Was sending |
|---|---|
| `GET /api/projects/{slug}/tasks` | every image, every board load |
| `GET .../versions/{version}/tasks` | same, per version |
| `PATCH .../tasks/{taskId}` ×4 branches | **the entire task list on every drag-reorder** |
| `GET/PUT/POST .../tasks/{taskId}` | full task |
| `GET /api/projects/{slug}/sprint` | embeds whole task objects |
| `GET /api/admin/snapshots/{id}` | **the entire snapshot** — to render three counts |

The PATCH branches were the worst of it: every card drag returned the whole list,
base64 included. The snapshot detail endpoint was the sharpest edge — one click on
"Details" could pull hundreds of MB. It now returns a summary; `?full=1` still gets
the whole thing for a real restore.

**Write side:**
- `MAX_ATTACH_BYTES` (1 MB) and a new 20-per-task limit now enforced in the API, returning 413. The cap was previously client-side only in three components and a direct POST bypassed it entirely.
- `setCover` / `toggleCover` store `{ attId }` instead of copying the image bytes a second time — every covered image was stored and sent twice.

**Verified:** `npm run build` clean; 23 round-trip assertions covering strip → edit →
merge, attachment removal, new uploads alongside stripped ones, cover clearing,
legacy covers with no `attId`, and oversize rejection. The merge path is the one that
would silently destroy images if wrong, so it is the most heavily covered.

---

## What I deliberately did not do

- **No deletion of anything.** Not snapshots, not orphans, not duplicates.
- **No stripping of images from stored snapshots.** It would reclaim the most space, but snapshots are the only point-in-time recovery this app has ([PRD.md:309-310](PRD.md#L309-L310)) and stripping them silently degrades the backup. Storage is not a metered quota, so there is no pressure forcing that tradeoff. Your call.
- **No `deleteTaskHistory` wiring.** Fixing it properly means changing `deleteTask` to return the deleted ids, which touches the locking path that both task routes depend on. Each history key is capped at 500 entries, so the leak is bounded and unrelated to the transfer quota. Not worth destabilising that path in the same change.

---

## Expected effect

The three repeat costs that produced the egress are gone: board loads, drag-reorders
and sprint views now carry metadata only, and image bytes are fetched once per
browser and then served from cache on an ETag. First load per user still transfers
each image once — that is unavoidable and is the correct floor.

I have not measured the new figure. Vercel's usage counters lag, so the honest check
is to redeploy and watch Fast Origin Transfer over the next few days.

---

## Still open for you

1. **Snapshot retention.** They are the largest thing in the store and nothing prunes them. How many to keep, and is any one load-bearing as a backup? Needed before any deletion.
2. **Read-only inventory run.** `node scripts/store-report.js` now exists — SCAN + size by prefix + top-N, writes nothing. I have not run it against production; it costs Upstash commands, so say the word.
3. **Attachments in Redis at all.** The real fix is `@vercel/blob` with content-hash keys, which also makes re-uploads overwrite instead of accumulate. Larger change; worth doing if attachment use keeps growing.
4. **`scripts/seed-*.js` have no environment guard** and `.env.local` points at production.
5. **Graphify not regenerated.** `graphify-out/` last built 2026-07-09 and the pipeline appears to have an API cost (`cost.json`). Given you are actively cutting spend I did not run it unprompted.
