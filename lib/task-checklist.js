// Trello/Jira-style checklist on a task.
//
// Stored on the task record as `task.checklist`: a flat, ordered array. Items
// are plain notes until someone ticks them, so the same list carries "remember
// this" and "do this" without a second field.
//
// Unlike the rest of the task, a checklist is *everyone's* — any account that
// can open the card may add, tick and edit items (see the self-service
// allowlist in the task PUT route). That makes bounds a server concern, not a
// UI one: sanitizeChecklist() is the gate every write passes through, so a
// hand-rolled request cannot grow one task's list past what the shared task
// list in redis can hold.

const MAX_CHECKLIST_ITEMS = 50;
const MAX_CHECKLIST_TEXT = 500;

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function makeChecklistItem(text, author) {
  return {
    id: `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: str(text, MAX_CHECKLIST_TEXT).trim(),
    done: false,
    createdBy: author || null,
    createdAt: new Date().toISOString(),
    doneBy: null,
    doneAt: null,
  };
}

// Normalise anything that arrives claiming to be a checklist. Non-arrays and
// items without text drop out; unknown keys are discarded rather than stored,
// so the field can never become an arbitrary payload smuggled onto the task.
function sanitizeChecklist(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const text = str(raw.text, MAX_CHECKLIST_TEXT).trim();
    if (!text) continue;
    const done = !!raw.done;
    out.push({
      id: str(raw.id, 64) || makeChecklistItem(text).id,
      text,
      done,
      createdBy: str(raw.createdBy, 120) || null,
      createdAt: str(raw.createdAt, 40) || null,
      doneBy: done ? (str(raw.doneBy, 120) || null) : null,
      doneAt: done ? (str(raw.doneAt, 40) || null) : null,
    });
    if (out.length >= MAX_CHECKLIST_ITEMS) break;
  }
  return out;
}

// Identity on a checklist item is server business: the client says *what* it
// wants the list to look like, never *who* did it. New items get their author
// from the session, and doneBy/doneAt are (re)stamped only on the tick that
// actually flipped — so a re-save never rewrites who ticked something last week.
function stampChecklist(next, prev, author) {
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

function checklistProgress(task) {
  const list = Array.isArray(task?.checklist) ? task.checklist : [];
  return { done: list.filter(i => i.done).length, total: list.length };
}

module.exports = {
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  makeChecklistItem,
  sanitizeChecklist,
  stampChecklist,
  checklistProgress,
};
