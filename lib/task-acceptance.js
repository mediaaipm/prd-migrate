// Acceptance criteria on a story.
//
// The hierarchy is Project › PRD version › story › sub-tasks. A story is a
// root-level task (the swimlane's lane, see components/KanbanBoard.js), and its
// acceptance criteria are the conditions that decide whether the story is
// actually finished. Stored on the task record as `task.acceptance`: a flat,
// ordered array of the same shape as a checklist item.
//
// It is deliberately NOT the checklist. A checklist is a scratchpad anyone may
// rewrite; acceptance criteria are the contract. Authoring them (add, retitle,
// remove, reorder) needs `task:update`; *ticking* one is a verification anyone
// who can open the card may do — that split is enforced server-side by
// acceptanceStructureIntact(), not by hiding buttons.
//
// Absent until something is written, exactly like `checklist`: a project's
// tasks live in ONE redis value, so an empty array on every task is real cost.

const MAX_ACCEPTANCE_ITEMS = 30;
const MAX_ACCEPTANCE_TEXT = 500;

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function makeAcceptanceItem(text, author) {
  return {
    id: `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: str(text, MAX_ACCEPTANCE_TEXT).trim(),
    done: false,
    createdBy: author || null,
    createdAt: new Date().toISOString(),
    doneBy: null,
    doneAt: null,
  };
}

// Normalise anything that arrives claiming to be an acceptance list. Non-arrays
// and items without text drop out; unknown keys are discarded rather than
// stored, so the field can never become an arbitrary payload smuggled onto the
// task.
function sanitizeAcceptance(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const text = str(raw.text, MAX_ACCEPTANCE_TEXT).trim();
    if (!text) continue;
    const done = !!raw.done;
    out.push({
      id: str(raw.id, 64) || makeAcceptanceItem(text).id,
      text,
      done,
      createdBy: str(raw.createdBy, 120) || null,
      createdAt: str(raw.createdAt, 40) || null,
      doneBy: done ? (str(raw.doneBy, 120) || null) : null,
      doneAt: done ? (str(raw.doneAt, 40) || null) : null,
    });
    if (out.length >= MAX_ACCEPTANCE_ITEMS) break;
  }
  return out;
}

// Identity is server business: the client says *what* it wants the list to look
// like, never *who* met a criterion. doneBy/doneAt are (re)stamped only on the
// tick that actually flipped, so a re-save never rewrites who signed something
// off last week.
function stampAcceptance(next, prev, author) {
  const prevById = new Map((Array.isArray(prev) ? prev : []).map(i => [i.id, i]));
  const now = new Date().toISOString();
  return (Array.isArray(next) ? next : []).map(item => {
    const was = prevById.get(item.id);
    if (!was) {
      return {
        ...item,
        createdBy: author || null,
        createdAt: item.createdAt || now,
        doneBy: item.done ? (author || null) : null,
        doneAt: item.done ? now : null,
      };
    }
    const base = { ...item, createdBy: was.createdBy || null, createdAt: was.createdAt || null };
    if (item.done && !was.done) return { ...base, doneBy: author || null, doneAt: now };
    if (!item.done) return { ...base, doneBy: null, doneAt: null };
    return { ...base, doneBy: was.doneBy || null, doneAt: was.doneAt || null };
  });
}

// True when `next` only flips tick boxes: same items, same wording, same order.
// This is the whole authoring/verifying split — a request from an account
// without `task:update` is accepted only when this holds, so a viewer can sign
// a criterion off but cannot quietly reword the contract they are signing.
function acceptanceStructureIntact(next, prev) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.id === b[i].id && item.text === b[i].text);
}

function acceptanceProgress(task) {
  const list = Array.isArray(task && task.acceptance) ? task.acceptance : [];
  return { met: list.filter(i => i.done).length, total: list.length };
}

// Unmet criteria on a task that is being called finished. Callers use this to
// warn, never to block: a story can be closed with criteria outstanding (scope
// gets cut, criteria get obsoleted), it just should not happen by accident.
function unmetAcceptance(task) {
  const list = Array.isArray(task && task.acceptance) ? task.acceptance : [];
  return list.filter(i => !i.done);
}

module.exports = {
  MAX_ACCEPTANCE_ITEMS,
  MAX_ACCEPTANCE_TEXT,
  makeAcceptanceItem,
  sanitizeAcceptance,
  stampAcceptance,
  acceptanceStructureIntact,
  acceptanceProgress,
  unmetAcceptance,
};
