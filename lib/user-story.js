// The user-story statement on a story: "As a <role>, I want <goal>, so that
// <benefit>". Stored as `task.userStory` on stories (root tasks) only, next to its
// acceptance criteria (lib/task-acceptance.js). Absent until something is written —
// a project's tasks are ONE redis value, so an empty object on every task is real cost.

const MAX_USER_STORY_TEXT = 300;
const USER_STORY_PARTS = [
  { key: 'role', label: 'As a', placeholder: 'type of user, e.g. project admin' },
  { key: 'goal', label: 'I want', placeholder: 'what they want to do' },
  { key: 'benefit', label: 'So that', placeholder: 'why it matters to them' },
];

function blankUserStory() {
  return { role: '', goal: '', benefit: '' };
}

// Anything claiming to be a user story → the three trimmed strings, or null when all
// three are empty (which also clears a stored one). Unknown keys are dropped.
function sanitizeUserStory(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const { key } of USER_STORY_PARTS) {
    out[key] = typeof v[key] === 'string' ? v[key].slice(0, MAX_USER_STORY_TEXT).trim() : '';
  }
  return out.role || out.goal || out.benefit ? out : null;
}

module.exports = { MAX_USER_STORY_TEXT, USER_STORY_PARTS, blankUserStory, sanitizeUserStory };
