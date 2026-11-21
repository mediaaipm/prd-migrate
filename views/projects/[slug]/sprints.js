import { useState, useEffect, useCallback, useMemo } from 'react'
import { accessUrl } from '../../../lib/config-cache'
import { useRouter } from '../../../lib/router-compat'
import Nav from '../../../components/Nav'
import PageHeader from '../../../components/PageHeader'
import dynamic from 'next/dynamic'
import SprintCurrent from '../../../components/SprintCurrent'
import SprintPlanner from '../../../components/SprintPlanner'
import SprintList from '../../../components/SprintList'
import { SprintFormModal, CadenceModal } from '../../../components/SprintModals'
import { apiFetch } from '../../../lib/api-fetch'
import { onSync } from '../../../lib/submit-queue'
import { scopeUserToProject } from '../../../lib/scoped-user'
import { useSprints, cadenceLabel } from '../../../lib/sprints'

// Metrics is the one tab with charts; load it when opened.
const SprintAnalytics = dynamic(() => import('../../../components/SprintAnalytics'), {
  loading: () => <div className="skeleton view-skeleton" aria-busy="true" />,
})

// The sprint area. Four tabs, one URL each (`?tab=`), so a link opens on the view it
// was copied from:
//   current  — the active sprint's header and board
//   plan     — unplanned stories → a planned/active sprint
//   all      — every sprint: active, planned, history with reviews
//   metrics  — burndown, velocity, story flow, team, holidays
const TABS = [
  { key: 'current', label: 'Current sprint' },
  { key: 'plan', label: 'Plan' },
  { key: 'all', label: 'All sprints' },
  { key: 'metrics', label: 'Metrics' },
]

export default function ProjectSprints({ currentUser }) {
  const router = useRouter()
  const { slug, tab: tabParam, sprint: sprintParam } = router.query
  const tab = TABS.some(t => t.key === tabParam) ? tabParam : 'current'
  const [projectName, setProjectName] = useState('')
  const [taskAcl, setTaskAcl] = useState(null)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [access, setAccess] = useState(null)
  const [allTasks, setAllTasks] = useState([])
  const [creating, setCreating] = useState(false)
  const [showCadence, setShowCadence] = useState(false)
  const { sprints, config, velocity, today, canManage, canDeleteCompleted, loading, error, forbidden, reload } = useSprints(slug)

  // The board resolves a card's story through the whole project, so it gets every
  // version's tasks — not just the default list.
  const loadTasks = useCallback(() => {
    if (!slug) return Promise.resolve()
    return apiFetch(`/api/projects/${slug}/tasks?allVersions=1`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (Array.isArray(data)) setAllTasks(data) })
      .catch(() => {})
  }, [slug])
  useEffect(() => { loadTasks() }, [loadTasks])

  // A card moved or edited on the board changes sprint progress — refetch both.
  useEffect(() => onSync(item => {
    if (item.optimistic?.entity === 'task') { loadTasks(); return reload() }
  }), [loadTasks, reload])

  useEffect(() => {
    if (!router.isReady || !slug) return
    apiFetch(`/api/projects/${slug}`).then(r => (r.ok ? r.json() : null)).then(p => {
      if (!p) return
      setProjectName(p.name || '')
      setTaskAcl(p.taskAcl || null)
      setTaskPrefix(p.taskPrefix || '')
    }).catch(() => {})
    apiFetch(accessUrl(slug)).then(r => (r.ok ? r.json() : null)).then(setAccess).catch(() => {})
  }, [router.isReady, slug])

  const scopedUser = useMemo(() => scopeUserToProject(currentUser, access), [currentUser, access])

  function go(nextTab, extra = {}) {
    const q = new URLSearchParams()
    if (nextTab !== 'current') q.set('tab', nextTab)
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
    const qs = q.toString()
    router.replace(`/projects/${slug}/sprints${qs ? `?${qs}` : ''}`, undefined, { shallow: true })
  }

  const active = sprints.find(s => s.status === 'active')

  return (
    <>
      <Nav projectName={projectName} />
      <main className="page page--full">
        <PageHeader
          title="Sprints"
          subtitle={<>
            {config ? cadenceLabel(config) : 'Plan stories from the backlog, run the sprint, and let unfinished work roll into the next one.'}
            {active && <> · <strong>{active.name}</strong> is running</>}
          </>}
          actions={canManage && <>
            <button className="btn-ghost" onClick={() => setShowCadence(true)}>⚙ Cadence</button>
            <button className="btn-primary" onClick={() => setCreating(true)}>+ New Sprint</button>
          </>}
        />

        <div className="epic-filters" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`epic-filter${tab === t.key ? ' is-on' : ''}`} onClick={() => go(t.key)}>
              {t.label}
              {t.key === 'all' && sprints.length > 0 && <span className="epic-filter-count">{sprints.length}</span>}
            </button>
          ))}
        </div>

        {forbidden && <div className="section-card epic-empty">You don't have access to sprints in this project.</div>}
        {error && <div className="kanban-col-error">{error}</div>}
        {loading && !forbidden && <span className="skeleton sprint-skeleton" />}

        {!loading && !forbidden && tab === 'current' && (
          <SprintCurrent
            slug={slug}
            sprints={sprints}
            config={config}
            today={today}
            velocity={velocity}
            canManage={canManage}
            allTasks={allTasks}
            currentUser={scopedUser}
            taskAcl={taskAcl}
            taskPrefix={taskPrefix}
            onPlan={s => go('plan', { sprint: s.id })}
            onCreateSprint={() => setCreating(true)}
          />
        )}
        {!loading && !forbidden && tab === 'plan' && (
          <SprintPlanner
            key={typeof sprintParam === 'string' ? sprintParam : 'plan'}
            slug={slug}
            sprints={sprints}
            velocity={velocity}
            canManage={canManage}
            initialSprintId={typeof sprintParam === 'string' ? sprintParam : ''}
            onCreateSprint={() => setCreating(true)}
          />
        )}
        {!loading && !forbidden && tab === 'all' && (
          <SprintList
            slug={slug}
            sprints={sprints}
            today={today}
            canManage={canManage}
            canDeleteCompleted={canDeleteCompleted}
            onOpen={s => (s.status === 'active' ? go('current') : go('plan', { sprint: s.id }))}
            onPlan={s => go('plan', { sprint: s.id })}
          />
        )}
        {!forbidden && tab === 'metrics' && (
          <div className="section-card" id="sprint-analytics">
            <SprintAnalytics
              slug={slug}
              currentUser={currentUser}
              sprintId={typeof sprintParam === 'string' ? sprintParam : undefined}
              onSprintChange={id => go('metrics', { sprint: id })}
            />
          </div>
        )}

        {creating && (
          <SprintFormModal
            slug={slug}
            defaults={null}
            onClose={() => setCreating(false)}
            onSaved={s => go('plan', { sprint: s.id })}
          />
        )}
        {showCadence && <CadenceModal slug={slug} onClose={() => setShowCadence(false)} />}
      </main>
    </>
  )
}
