import { getSessionUser } from '../../../lib/session'

// Lets the client validate its session on boot. localStorage is only a display
// cache now, so it must be reconciled against what the server actually accepts.
export default async function handler(req, res) {
  const user = getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in.' })
  return res.status(200).json({ ok: true, user })
}
