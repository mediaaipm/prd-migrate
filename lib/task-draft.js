import { newId } from './submit-queue'

// Shape of a task as the board, tree and calendar expect to read it, filled in with
// the same defaults createTask() applies on the server. Used as the `optimistic.data`
// of a queued create so the card renders complete rather than half-empty.
//
// `seq` and `number` are the two fields the client genuinely cannot know — they are
// allocated by redis. They stay null until the create syncs and the refetch lands;
// views render the pending marker instead of a task number.
export function taskDraft(fields = {}) {
  return {
    id: fields.id || newId('task'),
    seq: null,
    number: '',
    autoNumber: '',
    title: (fields.title || '').trim() || 'Untitled',
    description: fields.description || '',
    status: fields.status || 'todo',
    priority: fields.priority || 'medium',
    assignees: Array.isArray(fields.assignees) ? fields.assignees : (fields.assignee ? [fields.assignee] : []),
    assignedBy: fields.assignedBy || null,
    startDate: fields.startDate || null,
    dueDate: fields.dueDate || null,
    parentId: fields.parentId || null,
    // Sorts last in both the tree and the board until the server hands back a real
    // order, which is where a newly added card belongs anyway.
    order: Number.MAX_SAFE_INTEGER,
    boardOrder: Number.MAX_SAFE_INTEGER,
    numberOverride: fields.numberOverride || null,
    category: fields.category || null,
    labelIds: Array.isArray(fields.labelIds) ? fields.labelIds : [],
    attachments: Array.isArray(fields.attachments) ? fields.attachments : [],
    cover: fields.cover || null,
    archived: false,
    updates: [],
    createdAt: new Date().toISOString(),
  }
}

// The body to POST for a draft. Same object minus the fields the server owns.
export function taskCreateBody(draft) {
  const { seq, number, autoNumber, order, boardOrder, createdAt, updates, archived, ...body } = draft
  return body
}
