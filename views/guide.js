import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  UserCheck,
  Users,
  Compass, FolderKanban, ListTree, KanbanSquare, Inbox, Timer, Hash, Layers, FileText,
  BarChart3, Bell, ShieldCheck, Settings, HelpCircle, Search, ArrowUp, ArrowRight, X, ClipboardCheck,
} from 'lucide-react'
import Nav from '../components/Nav'
import { isSuperAdmin, isNestingCapped } from '../lib/client-permissions'
import { FIBONACCI_POINTS } from '../lib/story-points'
import { SUBTASK_STATUSES } from '../lib/subtask-status'
import { roleLabel as roleName } from '../lib/roles'

const sec = id => SECTIONS.find(x => x.id === id)

// How to use the tool, in the order a new person meets it. Written against what the
// app actually does — when a rule changes (cadence defaults, who may add what), the
// matching section here changes with it. Sections marked `admin` show only to admins.
const SECTIONS = [
  { id: 'start', title: 'Getting around', icon: Compass },
  { id: 'projects', title: 'Projects', icon: FolderKanban },
  { id: 'mytasks', title: 'My tasks', icon: UserCheck },
  { id: 'teams', title: 'Teams', icon: Users },
  { id: 'stories', title: 'Stories and sub-tasks', icon: ListTree },
  { id: 'board', title: 'Tasks: list, board, calendar', icon: KanbanSquare },
  { id: 'backlog', title: 'Backlog', icon: Inbox },
  { id: 'sprints', title: 'Sprints', icon: Timer },
  { id: 'qa', title: 'QA review', icon: ClipboardCheck },
  { id: 'points', title: 'Story points', icon: Hash },
  { id: 'epics', title: 'Epics', icon: Layers },
  { id: 'versions', title: 'Project Version', icon: FileText },
  { id: 'insights', title: 'Insights', icon: BarChart3 },
  { id: 'notifications', title: 'Notifications and saving', icon: Bell },
  { id: 'roles', title: 'Who can do what', icon: ShieldCheck },
  { id: 'admin', title: 'For admins', icon: Settings, admin: true },
  { id: 'faq', title: 'Common questions', icon: HelpCircle },
]

// The four things a new person does first, in order.
const QUICK_START = [
  { n: 1, title: 'Open your project', text: 'Projects → Open. The project bar shows its sections.', to: 'projects' },
  { n: 2, title: 'Find your work', text: 'Tasks → Board. Stories are cards; their sub-tasks sit under them.', to: 'board' },
  { n: 3, title: 'Update as you go', text: 'Set each sub-task: Not started, In progress, Done.', to: 'stories' },
  { n: 4, title: 'Follow the sprint', text: 'Sprints → Current sprint. It closes Friday, restarts Monday.', to: 'sprints' },
]

export default function Guide({ currentUser }) {
  const superAdmin = isSuperAdmin(currentUser)
  const isAdmin = !!(currentUser?.isAdmin || currentUser?.role === 'admin' || superAdmin)
  const capped = isNestingCapped(currentUser)
  const roleLabel = superAdmin ? 'Super admin' : roleName(currentUser?.role)
  const sections = useMemo(() => SECTIONS.filter(s => !s.admin || isAdmin), [isAdmin])
  const [active, setActive] = useState(sections[0].id)
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState(new Set())

  // Highlight the section being read in the contents list.
  useEffect(() => {
    const els = sections.map(s => document.getElementById(s.id)).filter(Boolean)
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActive(visible[0].target.id)
    }, { rootMargin: '-120px 0px -60% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  // Search: hide sections whose text does not contain every word typed.
  useEffect(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) { setHidden(new Set()); return }
    const out = new Set()
    for (const s of sections) {
      const text = (document.getElementById(s.id)?.textContent || '').toLowerCase()
      if (!words.every(w => text.includes(w))) out.add(s.id)
    }
    setHidden(out)
  }, [query, sections])

  const shown = sections.filter(s => !hidden.has(s.id))
  const subStates = SUBTASK_STATUSES.map(s => s.label).join(', ')

  return (
    <>
      <Nav />
      <main className="page guide-page">
        <header className="guide-hero">
          <div className="guide-hero-text">
            <span className="guide-eyebrow">Guide</span>
            <h1>How to use the Task Manager</h1>
            <p>From your first project to closing a sprint — everything in one place.</p>
            <span className="guide-role">Showing what a <strong>{roleLabel}</strong> can do</span>
          </div>
          <label className="guide-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              placeholder="Search the guide…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search the guide"
            />
            {query && <button type="button" className="guide-search-clear" onClick={() => setQuery('')} aria-label="Clear search"><X /></button>}
          </label>
        </header>

        {!query && (
          <ol className="guide-quick" aria-label="Quick start">
            {QUICK_START.map(q => (
              <li key={q.n}>
                <a href={`#${q.to}`} className="guide-quick-card">
                  <span className="guide-quick-n">{q.n}</span>
                  <strong>{q.title}</strong>
                  <span>{q.text}</span>
                  <ArrowRight className="guide-quick-arrow" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ol>
        )}

        <div className="guide-layout">
          <nav className="guide-toc" aria-label="Guide contents">
            <span className="guide-toc-title">On this page</span>
            {sections.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`guide-toc-link${active === s.id ? ' is-active' : ''}${hidden.has(s.id) ? ' is-dim' : ''}`}
              >
                <span className="guide-toc-n">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </a>
            ))}
          </nav>

          <article className="guide-body">
            {query && shown.length === 0 && (
              <div className="guide-empty">Nothing in the guide mentions “{query}”. Try another word, or <button type="button" className="guide-linkish" onClick={() => setQuery('')}>clear the search</button>.</div>
            )}
            {query && shown.length > 0 && (
              <div className="guide-results">{shown.length} section{shown.length === 1 ? '' : 's'} mention “{query}”</div>
            )}

            <Section s={sec('start')} hidden={hidden}>
              <p>The app has two bars at the top.</p>
              <ul>
                <li><strong>Top bar</strong> — this <em>Guide</em>, <em>Projects</em> (the home page), <em>My tasks</em>, <em>Teams</em> (managers and team leads), the theme picker (🎨 — ten light and dark themes, or <em>Match system</em> to follow your device), your notifications and your account menu (sign out, and Admin / Access control if you have them).</li>
                <li><strong>Project bar</strong> — appears once you open a project. It shows where you are and the project's sections: <em>Tasks, Backlog, Sprints, Epics, Project Version, Insights</em>. You only see the sections you have access to.</li>
              </ul>
              <Tip>Every task has a share link (🔗 on its card). Opening it takes the other person straight to that task.</Tip>
            </Section>

            <Section s={sec('projects')} hidden={hidden}>
              <p>The home page lists every project you can see. Search, or open <em>Filters</em> to narrow by status, priority or person.</p>
              <ul>
                <li><strong>Open</strong> takes you to the project's tasks.</li>
                <li>The <strong>⋯</strong> menu on a card holds rename and delete (admins only).</li>
                <li>Each card shows the latest version and the project's status (On hold, Archived) and priority.</li>
              </ul>
            </Section>

            <Section s={sec('mytasks')} hidden={hidden}>
              <p><strong>My tasks</strong> in the top bar lists every story and sub-task assigned to you, across all the projects you can see.</p>
              <ul>
                <li><strong>Open</strong> groups your work by due date: Overdue, Due today, Next 7 days, Later, No due date. Higher priority comes first within a group.</li>
                <li><strong>Done</strong> shows what you finished in the last 30 days.</li>
                <li>Work QA sent back shows its note. Click a task to open it in its project.</li>
                <li><strong>My team</strong> (switch at the top right) appears when people report to you. It shows each person's tasks with their open and overdue counts, including people who report to your team leads. <strong>Managers</strong> see every team, and can narrow to one team lead's team. You only see projects you have access to yourself.</li>
                <li>Who is on a team is set under Admin → Users — see <em>Teams</em> below.</li>
              </ul>
            </Section>

            <Section s={sec('teams')} hidden={hidden}>
              <p>A team is a <strong>team lead</strong> plus the people who report to them. Teams decide what <em>My team</em> and the <em>Teams</em> page show.</p>
              <h3>Set up a team</h3>
              <ol>
                <li>Open <em>Admin → Users</em> (admins and managers).</li>
                <li>Give the lead the <strong>Team lead</strong> or <strong>Manager</strong> role — only those two can lead a team.</li>
                <li>On each member's row, set <strong>Reports to</strong> to the lead. Set it back to <em>Nobody</em> to take someone off the team, or pick another lead to move them.</li>
              </ol>
              <p>Someone can report to only one lead, and the lead must be above them: <strong>Dev / QA → Team lead → Manager</strong>. Devs and QA report to a team lead or manager, team leads report to a manager, and a manager can report only to another manager. <em>Reports to</em> only offers people who fit. Changing someone's role clears any link that no longer fits (you're told which), as does making someone an admin. Loops (A reports to B, B reports to A) are refused. Deleting a lead leaves their people with no lead; renaming one carries over.</p>
              <h3>The Teams page</h3>
              <ul>
                <li><strong>Managers and admins</strong> see every team, with an <em>Overview</em> comparing them: people, open, overdue, rework, done and points in the last 30 days, the share done on time, and how often QA passed work first time. <strong>Team leads</strong> see their own team.</li>
                <li>A team's page shows its lead and members, open and overdue work, what was done in the last 30 days, a weekly throughput chart, open work by status, and each person's workload with the late part in red.</li>
                <li><em>Team performance</em> (last 30 days): work done on time, typical time to finish, stories and sub-tasks finished, how often QA sent work back, sprint carry-overs and blocked work.</li>
                <li><em>Member performance</em> puts everyone on the team side by side — open, overdue, done, points, on time, QA first pass, sent back, typical time. Click a column header to sort.</li>
                <li>Click a person's name for their performance page, <em>Tasks</em> under it for their task list, or <em>All tasks</em> for the whole team (<em>My tasks → My team</em>).</li>
                <li>Numbers only cover projects you can open yourself. A task shared by two members counts once in the team total.</li>
              </ul>
              <Tip>Older tasks don't record when they were finished, so “done in the last 30 days” uses their last change for those.</Tip>
              <h3>Performance pages</h3>
              <p>Every person has a performance page. Click a name or avatar anywhere — task list, board, sprint board, QA board, Insights workload, Teams, Admin, comments — or pick <em>My performance</em> from your account menu.</p>
              <ul>
                <li>Open and overdue work, what was done in the last 30 days (and how much of it on time), a 12-week throughput chart, and open work by status.</li>
                <li><em>Quality &amp; flow</em>: how often QA passed their stories first time, how often work was sent back, the typical time from start to done, sprint carry-overs, comments written and — for QA — reviews given.</li>
                <li>Their open and recently finished tasks, and a per-project breakdown. Use the project picker at the top to look at one project.</li>
              </ul>
              <Tip>Who can open whose page: everyone sees their own; team leads see the people under them; managers and admins see everyone. A name you can't open shows as plain text. Numbers only cover projects you can open yourself.</Tip>
            </Section>

            <Section s={sec('stories')} hidden={hidden}>
              <p>Work is a tree with two kinds of item:</p>
              <div className="guide-pair">
                <div className="guide-pair-card">
                  <strong>Story</strong>
                  <p>A top-level task: a piece of value the team delivers. Stories move across the board's columns, get planned into sprints and can belong to an epic. A story can carry a <em>user story</em> (As a… I want… so that…) and <em>acceptance criteria</em> — what must be true before it counts as done. Both can be filled in when you add the story or later on its card.</p>
                </div>
                <div className="guide-pair-card">
                  <strong>Sub-task</strong>
                  <p>The steps that build a story. A sub-task has only three statuses — <em>{subStates}</em> — set from the sub-task's row, not by dragging.</p>
                  <div className="guide-states">
                    {SUBTASK_STATUSES.map(st => <span key={st.status} className={`subtask-status subtask-status--${st.status} subtask-status--static`}>{st.label}</span>)}
                  </div>
                </div>
              </div>
              <p>Sub-tasks can have their own sub-tasks. Every level counts towards the story's progress (shown as <em>2/3 sub</em> on its card).</p>
              <Tip>{capped
                ? 'You can add sub-tasks under any story (and under its sub-tasks). New stories are added by a team lead, manager or admin.'
                : 'Devs and QA add sub-tasks but not stories — stories are added by team leads, managers and admins.'}</Tip>
            </Section>

            <Section s={sec('board')} hidden={hidden}>
              <p>The Tasks page has three views — switch at the top right. The <em>All tasks</em> tab and the version tabs choose which version's list you are looking at.</p>
              <h3>Board</h3>
              <ul>
                <li><strong>Only stories are cards.</strong> Drag a story to another column to change its status.</li>
                <li>A story's sub-tasks are listed under its card, each with its own status pill — pick <em>{subStates}</em> right there. Sub-tasks do not drag.</li>
                <li><strong>Moving a story to Done closes its open sub-tasks.</strong> Moving it anywhere else leaves sub-task statuses as they are. Finished sub-tasks are never reopened.</li>
                <li>If a story has acceptance criteria that are not all met, moving it to Done asks you to confirm.</li>
                <li>Click a card to open it: description, user story, acceptance criteria, checklist, attachments, comments (use <em>@name</em> to mention someone), history, and a <em>Board</em> tab showing all its sub-tasks by stage. Its header has <em>Copy link</em> and <em>History</em>; a story QA sent back shows the reason at the top; <em>⌘/Ctrl + Enter</em> saves.</li>
                <li><em>Filters</em> narrows by status, priority, category, label, dates or person. A story shown faded is there only because one of its sub-tasks matches.</li>
              </ul>
              <h3>List</h3>
              <p>The same tree as a table — status, priority, points, people, due date and ID in columns. Change a status right from its pill, expand a story to see its sub-tasks, drag rows to reorder or re-nest, and use a row's <em>⋯</em> menu to add a sub-task, edit, copy a link, open its board, comment or archive.</p>
              <h3>Calendar</h3>
              <p>Tasks on their due dates. Drag a task to another day to move its due date.</p>
            </Section>

            <Section s={sec('backlog')} hidden={hidden}>
              <p>Stories that are not planned yet. A new story starts here unless you give it a status. The backlog is grouped by epic, so you can see what is waiting for each piece of work.</p>
              <p>Planning a story into a sprint moves it to <em>To Do</em>.</p>
            </Section>

            <Section s={sec('sprints')} hidden={hidden}>
              <p>A sprint is a fixed slice of time the team commits a set of stories to. The page has four tabs: <em>Current sprint, Plan, All sprints, Metrics</em>.</p>
              <h3>How the cadence works (default)</h3>
              <ol className="guide-steps">
                <li>Sprints run <strong>two weeks, Monday to Friday</strong>.</li>
                <li><strong>At the end of the last Friday</strong> the sprint closes by itself. Every unfinished story moves into the next sprint, and its ↻ counter goes up so slipping work stands out.</li>
                <li>The <strong>next sprint is always opened</strong> at close, and it <strong>starts by itself on the following Monday</strong>.</li>
                <li><strong>Complete sprint</strong> appears on the sprint's last day. Completing it then does the same as the automatic close — you will see the next sprint as <em>Up next</em>, still starting on Monday.</li>
              </ol>
              <h3>Running a sprint</h3>
              <ul>
                <li><em>Plan</em> — pick stories from the backlog into a sprint. Their sub-tasks come along automatically.</li>
                <li><em>Current sprint</em> — the sprint's goal, days left, progress, and its own board.</li>
                <li><em>Metrics</em> — burndown, velocity and what was carried over, for every sprint.</li>
              </ul>
              {isAdmin && <Tip>Admins can change all of this in <em>Sprints → ⚙ Cadence</em>: length, start and end day, auto-close, auto-start, always opening the next sprint, and allowing early completion.</Tip>}
            </Section>

            <Section s={sec('qa')} hidden={hidden}>
              <p>The <em>QA Review</em> tab in the project bar is where finished stories get checked before they count as done.</p>
              <ol className="guide-steps">
                <li><strong>Hand it over.</strong> When a story is built, its dev moves it to the <em>QA Review</em> column. It appears on the QA board and the project's QA accounts get a notification.</li>
                <li><strong>QA checks it</strong> against the user story and acceptance criteria shown on the card. <em>Open card</em> (or the story title) opens the whole story right there on the QA board — user story, description, sub-tasks, comments, QA history — and you can tick acceptance criteria off as you check them. <em>Open full card ↗</em> goes to the task page.</li>
                <li><strong>Pass</strong> moves it to <em>Done</em> (any open sub-tasks close with it). Unmet acceptance criteria ask for confirmation first.</li>
                <li><strong>Send back</strong> needs a note saying what to fix. The story moves to the <em>Rework</em> column of the current sprint (pulled in from a later sprint if needed), the note is added to its comments, and the people on it are notified.</li>
                <li>The dev fixes it and moves it to <em>QA Review</em> again. The card shows which round it is on.</li>
              </ol>
              <Tip>Verdicts are given by QA, team leads, managers and admins. A QA who is assigned to a story cannot pass it themselves. Devs cannot move a story to Rework or Done on their own — that comes from QA.</Tip>
            </Section>

            <Section s={sec('points')} hidden={hidden}>
              <p>Story points estimate size, not hours. They use the Fibonacci scale:</p>
              <div className="guide-points">
                {FIBONACCI_POINTS.map(p => <span key={p}>{p}</span>)}
              </div>
              <p>The gaps grow on purpose — past a few points nobody can tell a 6 from a 7. Bigger than {FIBONACCI_POINTS[FIBONACCI_POINTS.length - 1]}? Split the story. Leave points blank if you do not estimate: an unestimated task counts as 1, so velocity still works.</p>
            </Section>

            <Section s={sec('epics')} hidden={hidden}>
              <p>An epic groups related stories — across versions — into one larger piece of work, with its own owner, dates and progress. Link a story to an epic from the story's card or from the Epics page. Sub-tasks follow their story.</p>
            </Section>

            <Section s={sec('versions')} hidden={hidden}>
              <p>The written requirements for the project, kept as numbered versions. Anyone with access can read every version and compare two of them side by side. Changes come in as <strong>proposals</strong>: someone suggests an edit, and an admin promotes it into a new version or rejects it.</p>
            </Section>

            <Section s={sec('insights')} hidden={hidden}>
              <p>One page on how the project is going: overall progress, the current sprint's burndown (points left each day against the ideal line), where stories sit in the pipeline, sprint history (committed vs done) with velocity, the QA queue and first-time pass rate, what needs attention (overdue, due within 7 days, keeps slipping), who has what open (and how much of it is late), and epics in progress. Hover a chart for exact numbers; the sprint history also has a table.</p>
            </Section>

            <Section s={sec('notifications')} hidden={hidden}>
              <ul>
                <li>The bell shows when you are assigned, mentioned, or a task you are on changes or is running late. Click one to jump to the task.</li>
                <li>Changes show on screen immediately and save in the background. The sync indicator tells you if anything is still saving — wait for it before closing the tab or signing out.</li>
                <li>If you are offline or the server is busy, your changes wait and send themselves when it is back.</li>
              </ul>
            </Section>

            <Section s={sec('roles')} hidden={hidden}>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr><th>Action</th><th>Dev</th><th>QA</th><th>Team lead</th><th>Manager</th><th>Admin</th><th>Super admin</th></tr>
                  </thead>
                  <tbody>
                    <Row what="See projects, tasks, sprints, insights, the QA board" r="dqtmas" />
                    <Row what="Change status of tasks assigned to you, hand a story to QA" r="dqtmas" />
                    <Row what="Add sub-tasks" r="dqtmas" />
                    <Row what="Pass a story or send it back for rework" r="qtmas" />
                    <Row what="Add stories" r="tmas" />
                    <Row what="Plan sprints, manage epics" r="tmas" />
                    <Row what="Move stories into gated statuses (Done, Rework, Backlog, Blocked)" r="tmas" />
                    <Row what="See your team's tasks and performance (My team, Teams)" r="tmas" />
                    <Row what="See your own performance page" r="dqtmas" />
                    <Row what="See the performance of people under you" r="tm" />
                    <Row what="See everyone's performance" r="mas" />
                    <Row what="See every team" r="mas" />
                    <Row what="Manage team members, their roles and who they report to" r="mas" />
                    <Row what="Admin pages: users, groups, holidays, snapshots, audit" r="as" />
                    <Row what="Delete tasks, edit board columns and categories" r="s" />
                    <Row what="Access control: role permissions, groups, project visibility" r="s" />
                  </tbody>
                </table>
              </div>
              <p className="guide-note">This is the default. A super admin can change what each role may do — per project — so your access may differ.</p>
            </Section>

            {isAdmin && (
              <Section s={sec('admin')} hidden={hidden}>
                <ul>
                  <li><strong>Admin</strong> (account menu) — users, admins, groups, holidays, snapshots and the audit log. In the Users list, each row has the person's <em>Role</em> (Manager, Team lead, Dev, QA — only admins can make someone a Manager) and <em>Reports to</em> (their team). Sign-in, projects & permissions, rename and remove are in the row's <strong>⋯</strong> menu. Filter by role, or by <em>Can’t sign in</em> to find people with no username or password. Each section has its own link (<code>/admin?tab=audit</code>).</li>
                  {superAdmin && <li><strong>Access control</strong> — what each role may do, globally or per project, and which statuses regular users may not set. Groups bundle permissions and project visibility for many people at once.</li>}
                  <li><strong>Sprint cadence</strong> — <em>Sprints → ⚙ Cadence</em>.</li>
                  <li><strong>Board columns and categories</strong> — edited from the board itself (super admin).</li>
                  <li><strong>Snapshots</strong> — take one before a big change; it can be restored from Admin → Snapshots.</li>
                </ul>
              </Section>
            )}

            <Section s={sec('faq')} hidden={hidden}>
              <Faq q="Why can't I drag a sub-task?">Only stories move between columns. Set a sub-task's status from the pill on its row, or open it and change it there.</Faq>
              <Faq q="Why can't I set a task to Done?">A dev's story reaches Done by passing QA: move it to <em>QA Review</em> instead. Other gated statuses are set by leads and admins.</Faq>
              <Faq q="My story came back in Rework.">QA sent it back — the reason is in its comments and on the QA board's <em>Sent back</em> tab. Fix it, then move it to <em>QA Review</em> again.</Faq>
              <Faq q={'Why don’t I see “Add Story”?'}>Stories are added by team leads, managers and admins. You can add sub-tasks under any story with <em>+ sub</em> / <em>+ sub-task</em>.</Faq>
              <Faq q="Why is the Complete sprint button missing?">It appears on the sprint's last day. Until then the sprint shows the date it can be completed on.</Faq>
              <Faq q="A story keeps moving to the next sprint.">It was unfinished when the sprint closed. The ↻ number on the card is how many sprints it has been carried through — a good sign it needs splitting or a decision.</Faq>
              <Faq q="How do I put people on a team?">Admin → Users: make the lead a Team lead (or Manager), then set <em>Reports to</em> on each member's row.</Faq>
              <Faq q={'Why don’t I see the Teams link?'}>It is for managers, admins and team leads. A team lead with nobody reporting to them sees an empty page until an admin or manager sets up their team.</Faq>
              <Faq q={'I don’t see a project or a section.'}>Access is set per project. Ask an admin to add you to the project or grant the section.</Faq>
            </Section>

            <footer className="guide-foot">
              <span>Still stuck? Ask your project admin.</span>
              <span className="guide-foot-links">
                <a href="#top" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><ArrowUp aria-hidden="true" /> Back to top</a>
                <Link href="/">Back to projects</Link>
              </span>
            </footer>
          </article>
        </div>
      </main>
    </>
  )
}

function Section({ s, hidden, children }) {
  const Icon = s.icon
  return (
    <section id={s.id} className="guide-section" hidden={hidden.has(s.id)}>
      <h2>
        <span className="guide-section-icon" aria-hidden="true"><Icon /></span>
        <a href={`#${s.id}`} className="guide-anchor">{s.title}</a>
      </h2>
      {children}
    </section>
  )
}

function Tip({ children }) {
  return <div className="guide-tip"><strong>Tip</strong><span>{children}</span></div>
}

// r: which roles may — d dev, q QA, t team lead, m manager, a admin, s super admin.
function Row({ what, r }) {
  const mark = on => <td className={on ? 'guide-yes' : 'guide-no'}>{on ? '✓' : '—'}</td>
  return <tr><td>{what}</td>{[...'dqtmas'].map(k => <Fragment key={k}>{mark(r.includes(k))}</Fragment>)}</tr>
}

function Faq({ q, children }) {
  return (
    <details className="guide-faq">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  )
}
