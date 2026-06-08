import { logAudit } from '../../../lib/audit-log'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  await logAudit(req, 'logout', 'auth', {})
  res.status(200).json({ ok: true })
}
