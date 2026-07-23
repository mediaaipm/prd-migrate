import { logAudit } from '../../../lib/audit-log'
import { clearSessionCookie } from '../../../lib/session'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  await logAudit(req, 'logout', 'auth', {})
  clearSessionCookie(res)
  res.status(200).json({ ok: true })
}
