import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from '../../../lib/router-compat'
import Nav from '../../../components/Nav'
import PersonLink from '../../../components/PersonLink'
import PageHeader from '../../../components/PageHeader'
import { apiFetch } from '../../../lib/api-fetch'
import { onSync } from '../../../lib/submit-queue'
import { USER_STORY_PARTS } from '../../../lib/user-story'
import { subtaskStatusLabel } from '../../../lib/subtask-status'

// The QA board (lib/qa-store.js). Three lists, one URL each (`?tab=`):
//   review  — stories a dev moved to QA Review, oldest first
//   rework  — stories QA sent back; they sit in the current sprint's Rework column
//   passed  — passed in the last 14 days
// Everyone who can see tasks sees the board; the Pass / Send back buttons need
// qa:review (QA, team lead, manager, admin by default). The server re-checks all of it.
// "Open card" opens the story in a modal here (QaCardModal); the full task page is one
// link further.
const TABS = [
  { key: 'review', label: 'Waiting for QA' },
  { key: 'rework', label: 'Sent back' },
  { key: 'passed', label: 'Passed' },
]

function ago(iso) {
  const t = Date.parse(iso || '')
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function taskApi(slug, item) {
  return item.version
    ? `/api/projects/${slug}/versions/${encodeURIComponent(item.version)}/tasks/${encodeURIComponent(item.id)}`
    : `/api/projects/${slug}/tasks/${encodeURIComponent(item.id)}`
}

// The story, read in place: description, acceptance criteria (tickable — ticking needs
// only card access, the server's structure guard keeps authoring to editors), sub-tasks,
// attachments, comments and the QA history. The verdict buttons sit in the footer.
function QaCardModal({ item, slug, id, cardHref, tab, actions, error, onClose, onChanged }) {
  const [full, setFull] = useState(null)
  const [acceptance, setAcceptance] = useState(item.acceptance)
  const [acError, setAcError] = useState('')
  const panelRef = useRef(null)

  useEffect(() => {
    let live = true
    apiFetch(taskApi(slug, item)).then(r => (r.ok ? r.json() : null)).then(t => { if (live && t) { setFull(t); if (Array.isArray(t.acceptance)) setAcceptance(t.acceptance) } }).catch(() => {})
    return () => { live = false }
  }, [slug, item])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function tick(acId) {
    const prev = acceptance
    const next = acceptance.map(a => (a.id === acId ? { ...a, done: !a.done } : a))
    setAcceptance(next); setAcError('')
    try {
      const res = await apiFetch(taskApi(slug, item), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptance: next }) })
      if (!res.ok) { setAcceptance(prev); setAcError((await res.json().catch(() => ({}))).error || 'Could not save.'); return }
      onChanged()
    } catch {
      setAcceptance(prev); setAcError('Could not save.')
    }
  }

  const us = full ? full.userStory : item.userStory
  const met = acceptance.filter(a => a.done).length
  const description = full ? full.description : item.description
  const attachments = (full?.attachments || []).filter(a => a && a.url)
  const comments = Array.isArray(full?.updates) ? full.updates : []
  const log = item.qa?.log || []
  const rounds = Number(item.qa?.rounds) || 0

  return (
    <div className="kanban-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kanban-modal qa-modal" role="dialog" aria-modal="true" aria-label={item.title} tabIndex={-1} ref={panelRef}>
        <div className="kanban-modal-header qa-modal-head">
          <div className="qa-card-title">
            {id && <span className="qa-card-id">{id}</span>}
            <span className="qa-modal-title">{item.title}</span>
          </div>
          <button className="kanban-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
        </div>

        <div className="qa-modal-body">
          <div className="qa-card-chips">
            {rounds > 0 && <span className="qa-chip qa-chip--round">Round {rounds + (tab === 'review' ? 1 : 0)}</span>}
            {item.points != null && <span className="qa-chip">{item.points} pts</span>}
            {item.priority && <span className={`qa-chip qa-chip--${item.priority}`}>{item.priority}</span>}
            {item.sprint && <span className="qa-chip qa-chip--sprint">{item.sprint.name}</span>}
            <span className="qa-modal-people">{item.assignees.length ? item.assignees.map((n, i) => <span key={n}>{i > 0 && ', '}<PersonLink name={n} /></span>) : 'Unassigned'}</span>
          </div>

          <section className="qa-modal-sec">
            <h3>User story</h3>
            {us && USER_STORY_PARTS.some(p => us[p.key]) ? (
              <p className="qa-card-story">
                {USER_STORY_PARTS.filter(p => us[p.key]).map((p, i) => (
                  <span key={p.key}>{i > 0 ? ', ' : ''}<strong>{p.label}</strong> {us[p.key]}</span>
                ))}
              </p>
            ) : <p className="qa-modal-empty">No user story written for this story.</p>}
          </section>

          <section className="qa-modal-sec">
            <h3>Description</h3>
            {description
              ? <p className="qa-modal-desc">{description}</p>
              : <p className="qa-modal-empty">No description.</p>}
          </section>

          <section className="qa-modal-sec">
            <h3>Acceptance criteria {acceptance.length > 0 && <span className="qa-modal-count">{met}/{acceptance.length} met</span>}</h3>
            {acceptance.length === 0 ? <p className="qa-modal-empty">No acceptance criteria written for this story.</p> : (
              <ul className="qa-modal-ac">
                {acceptance.map(a => (
                  <li key={a.id}>
                    <label className={a.done ? 'is-met' : ''}>
                      <input type="checkbox" checked={!!a.done} onChange={() => tick(a.id)} />
                      <span>{a.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {acError && <div className="kanban-col-error">{acError}</div>}
          </section>

          <section className="qa-modal-sec">
            <h3>Sub-tasks {item.subtasks.total > 0 && <span className="qa-modal-count">{item.subtasks.done}/{item.subtasks.total} done</span>}</h3>
            {!(item.subtaskList || []).length ? <p className="qa-modal-empty">No sub-tasks.</p> : (
              <ul className="qa-modal-subs">
                {item.subtaskList.map(t => (
                  <li key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                    <span className={`qa-modal-sub-status qa-modal-sub-status--${t.status === 'done' ? 'done' : t.status === 'todo' || t.status === 'backlog' ? 'todo' : 'doing'}`}>{subtaskStatusLabel(t.status)}</span>
                    <span className="qa-modal-sub-title">{t.title}</span>
                    {t.assignees.length > 0 && <span className="qa-modal-sub-who">{t.assignees.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {attachments.length > 0 && (
            <section className="qa-modal-sec">
              <h3>Attachments <span className="qa-modal-count">{attachments.length}</span></h3>
              <ul className="qa-modal-files">
                {attachments.map(a => (
                  <li key={a.id}><a href={a.url} target="_blank" rel="noreferrer">{a.name || 'Attachment'}</a></li>
                ))}
              </ul>
            </section>
          )}

          {comments.length > 0 && (
            <section className="qa-modal-sec">
              <h3>Comments <span className="qa-modal-count">{comments.length}</span></h3>
              <ul className="qa-modal-log">
                {comments.slice(-10).map(c => (
                  <li key={c.id}>
                    <div className="qa-modal-log-head"><strong>{c.author ? <PersonLink name={c.author} /> : 'Someone'}</strong> · {ago(c.createdAt)}</div>
                    <div className="qa-modal-log-text">{c.text}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {log.length > 0 && (
            <section className="qa-modal-sec">
              <h3>QA history</h3>
              <ul className="qa-modal-log">
                {[...log].reverse().map((l, i) => (
                  <li key={i}>
                    <div className="qa-modal-log-head">
                      <span className={`qa-modal-verdict qa-modal-verdict--${l.verdict}`}>{l.verdict === 'pass' ? 'Passed' : 'Sent back'}</span>
                      {' '}by <strong><PersonLink name={l.by} /></strong> · {ago(l.at)}
                    </div>
                    {l.note && <div className="qa-modal-log-text">{l.note}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {error && <div className="kanban-col-error qa-modal-error">{error}</div>}
        <div className="qa-modal-foot">
          <Link href={cardHref} className="sprint-edit-full">Open full card ↗</Link>
          {actions}
        </div>
      </div>
    </div>
  )
}

function QaCard({ item, slug, tab, prefix, canReview, currentUser, onDone, onChanged }) {
  const [mode, setMode] = useState(null) // null | 'rework'
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = item.seq != null ? (prefix ? `${prefix}-${item.seq}` : `#${item.seq}`) : (item.number ? `#${item.number}` : '')
  const cardHref = `/projects/${slug}/tasks?${item.version ? `version=${encodeURIComponent(item.version)}&` : ''}task=${encodeURIComponent(item.id)}`
  const openSubs = item.subtasks.total - item.subtasks.done
  const rounds = Number(item.qa?.rounds) || 0
  const mine = !!currentUser?.name && item.assignees.includes(currentUser.name)
  const us = item.userStory
  const lastRework = [...(item.qa?.log || [])].reverse().find(l => l.verdict === 'rework')

  async function send(verdict, allowUnmet = false) {
    setBusy(true); setError('')
    try {
      const res = await apiFetch(`/api/projects/${slug}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: item.id, version: item.version, verdict, note: verdict === 'rework' ? note : '', allowUnmet }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 409 && d.code === 'UNMET') {
        const list = (d.unmet || []).map(t => `  • ${t}`).join('\n')
        if (confirm(`${d.error}\n\n${list}\n\nPass it anyway?`)) return send(verdict, true)
        return
      }
      if (!res.ok) { setError(d.error || 'Could not save the verdict.'); if (res.status === 409) onDone(null); return }
      setMode(null); setNote(''); setOpen(false)
      onDone({ verdict, title: item.title, ...d })
    } finally {
      setBusy(false)
    }
  }

  const closeModal = useCallback(() => setOpen(false), [])

  function pass() {
    if (openSubs > 0 && !confirm(`${openSubs} sub-task${openSubs === 1 ? ' is' : 's are'} still open. Passing closes ${openSubs === 1 ? 'it' : 'them'} as Done. Continue?`)) return
    send('pass')
  }

  const canVerdict = tab === 'review' && canReview
  const actions = canVerdict && mode === 'rework' ? (
    <div className="qa-card-rework">
      <textarea
        className="form-input"
        rows={3}
        autoFocus
        maxLength={1000}
        placeholder="What needs reworking? The dev sees this on the card and in their notifications."
        value={note}
        onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setMode(null) } }}
      />
      <div className="qa-card-actions">
        <button className="btn-ghost" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
        <button className="btn-primary qa-btn-rework" onClick={() => send('rework')} disabled={busy || note.trim().length < 3}>
          {busy ? 'Sending…' : 'Send back for rework'}
        </button>
      </div>
    </div>
  ) : (canVerdict || !open) && (
    <div className="qa-card-actions">
      {!open && <button className="btn-ghost" onClick={() => setOpen(true)}>Open card</button>}
      {canVerdict && <button className="btn-ghost" onClick={() => setMode('rework')} disabled={busy}>Send back…</button>}
      {canVerdict && (
        <button
          className="btn-primary"
          onClick={pass}
          disabled={busy || (mine && !currentUser?.isLead && !currentUser?.isAdmin)}
          title={mine && !currentUser?.isLead && !currentUser?.isAdmin ? 'You are on this story — someone else has to pass it' : undefined}
        >{busy ? 'Saving…' : 'Pass QA'}</button>
      )}
    </div>
  )

  return (
    <article className={`qa-card qa-card--${tab}`}>
      <header className="qa-card-head">
        <div className="qa-card-title">
          {id && <span className="qa-card-id">{id}</span>}
          <button type="button" className="qa-card-name" onClick={() => setOpen(true)}>{item.title}</button>
        </div>
        <div className="qa-card-chips">
          {rounds > 0 && <span className="qa-chip qa-chip--round" title="Times sent back">Round {rounds + (tab === 'review' ? 1 : 0)}</span>}
          {item.points != null && <span className="qa-chip" title="Story points">{item.points} pts</span>}
          {item.priority && <span className={`qa-chip qa-chip--${item.priority}`}>{item.priority}</span>}
          {item.sprint && <span className="qa-chip qa-chip--sprint" title={`Sprint (${item.sprint.status})`}>{item.sprint.name}</span>}
        </div>
      </header>

      <div className="qa-card-meta">
        <span>{item.assignees.length ? item.assignees.map((n, i) => <span key={n}>{i > 0 && ', '}<PersonLink name={n} /></span>) : 'Unassigned'}</span>
        {tab === 'review' && item.qa?.submittedAt && <span>· handed over {ago(item.qa.submittedAt)}{item.qa.submittedBy ? <> by <PersonLink name={item.qa.submittedBy} /></> : ''}</span>}
        {tab !== 'review' && item.qa?.at && <span>· {tab === 'passed' ? 'passed' : 'sent back'} {ago(item.qa.at)} by <PersonLink name={item.qa.by} /></span>}
        <span>· sub-tasks {item.subtasks.done}/{item.subtasks.total}</span>
      </div>

      {us && (
        <p className="qa-card-story">
          {USER_STORY_PARTS.filter(p => us[p.key]).map((p, i) => (
            <span key={p.key}>{i > 0 ? ', ' : ''}<strong>{p.label}</strong> {us[p.key]}</span>
          ))}
        </p>
      )}

      {item.acceptance.length > 0 ? (
        <div className="qa-card-ac">
          <div className="qa-card-ac-head">Acceptance criteria · {item.acceptanceMet}/{item.acceptanceTotal} met</div>
          <ul>
            {item.acceptance.map(a => (
              <li key={a.id} className={a.done ? 'is-met' : ''}>
                <span aria-hidden="true">{a.done ? '✓' : '○'}</span> {a.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="qa-card-ac qa-card-ac--none">No acceptance criteria written for this story.</div>
      )}

      {(tab === 'rework' || (tab === 'review' && lastRework)) && (tab === 'rework' ? item.qa?.note : lastRework?.note) && (
        <blockquote className="qa-card-note">
          <span>{tab === 'rework' ? 'Reason' : 'Last sent back'}:</span> {tab === 'rework' ? item.qa.note : lastRework.note}
        </blockquote>
      )}

      {error && <div className="kanban-col-error">{error}</div>}

      {!open && actions}
      {open && (
        <QaCardModal item={item} slug={slug} id={id} cardHref={cardHref} tab={tab} actions={actions} error={error} onClose={closeModal} onChanged={onChanged} />
      )}
    </article>
  )
}

export default function ProjectQa({ currentUser }) {
  const router = useRouter()
  const { slug, tab: tabParam } = router.query
  const tab = TABS.some(t => t.key === tabParam) ? tabParam : 'review'
  const [project, setProject] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [query, setQuery] = useState('')
  const [person, setPerson] = useState('')
  const [flash, setFlash] = useState('')

  const load = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/qa`)
      .then(async r => {
        if (r.status === 403) { setForbidden(true); return }
        if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Could not load the QA board.'); return }
        setError(''); setData(await r.json())
      })
      .catch(() => setError('Could not load the QA board.'))
  }, [slug])
  useEffect(() => { load() }, [load])
  // A card moved anywhere else (board, list, sprint) can enter or leave review.
  useEffect(() => onSync(item => { if (item.optimistic?.entity === 'task') load() }), [load])

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`).then(r => (r.ok ? r.json() : null)).then(p => { if (p) setProject(p) }).catch(() => {})
  }, [router.isReady, slug])

  function go(next) {
    router.push(`/projects/${slug}/qa${next === 'review' ? '' : `?tab=${next}`}`)
  }

  function onDone(result) {
    load()
    if (!result) return
    if (result.verdict === 'pass') {
      setFlash(`Passed “${result.title}” — now Done${result.closedSubtasks ? `, ${result.closedSubtasks} open sub-task${result.closedSubtasks === 1 ? '' : 's'} closed` : ''}.`)
    } else {
      const where = result.sprint
        ? `${result.movedToSprint ? 'moved to' : 'in'} the Rework column of ${result.sprint.name}`
        : `in Rework (${result.sprintNote || 'no open sprint'})`
      setFlash(`Sent “${result.title}” back — ${where}. The people on it were notified.`)
    }
  }

  const list = (data && data[tab]) || []
  const people = useMemo(() => {
    const s = new Set()
    for (const k of ['review', 'rework', 'passed']) for (const i of (data?.[k] || [])) i.assignees.forEach(a => s.add(a))
    return [...s].sort()
  }, [data])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter(i => (!person || i.assignees.includes(person))
      && (!q || i.title.toLowerCase().includes(q) || String(i.seq ?? '').includes(q) || (i.description || '').toLowerCase().includes(q)))
  }, [list, query, person])

  return (
    <>
      <Nav projectName={project?.name || ''} />
      <main className="page page--full">
        <PageHeader
          title="QA Review"
          subtitle="Stories devs moved to QA Review. Pass them to Done, or send them back — they land in the Rework column of the current sprint."
        />

        <div className="epic-filters" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`epic-filter${tab === t.key ? ' is-on' : ''}`} onClick={() => go(t.key)}>
              {t.label}
              {data && <span className="epic-filter-count">{(data[t.key] || []).length}</span>}
            </button>
          ))}
        </div>

        {forbidden && <div className="section-card epic-empty">You don't have access to tasks in this project.</div>}
        {error && <div className="kanban-col-error">{error}</div>}
        {flash && (
          <div className="qa-flash" role="status">
            {flash}
            <button className="qa-flash-close" onClick={() => setFlash('')} aria-label="Dismiss">✕</button>
          </div>
        )}
        {data && !data.hasReviewColumn && (
          <div className="qa-warning">This project's board has no <strong>In Review</strong> column, so nothing can be handed to QA. A superadmin can add a column with the key <code>in-review</code> under Tasks → Board → columns.</div>
        )}
        {data && !data.canReview && tab === 'review' && (
          <div className="qa-hint">You can follow the queue. Verdicts are given by QA, team leads, managers and admins.</div>
        )}

        {!data && !forbidden && !error && <span className="skeleton sprint-skeleton" />}

        {data && (
          <>
            {(list.length > 0) && (
              <div className="qa-toolbar">
                <input className="form-input" placeholder="Search stories…" value={query} onChange={e => setQuery(e.target.value)} />
                {people.length > 0 && (
                  <select className="form-input" value={person} onChange={e => setPerson(e.target.value)} aria-label="Filter by person">
                    <option value="">Everyone</option>
                    {people.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </div>
            )}
            {shown.length === 0 ? (
              <div className="section-card epic-empty">
                {list.length
                  ? 'Nothing matches that filter.'
                  : tab === 'review' ? 'Nothing is waiting for QA. A story shows up here when it is moved to QA Review.'
                    : tab === 'rework' ? 'Nothing has been sent back.'
                      : 'Nothing passed QA in the last 14 days.'}
              </div>
            ) : (
              <div className="qa-list">
                {shown.map(item => (
                  <QaCard
                    key={`${item.version || ''}:${item.id}`}
                    item={item}
                    slug={slug}
                    tab={tab}
                    prefix={project?.taskPrefix || ''}
                    canReview={!!data.canReview}
                    currentUser={currentUser}
                    onDone={onDone}
                    onChanged={load}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
