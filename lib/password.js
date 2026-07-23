// Password hashing with scrypt (node built-in — no new dependency).
//
// Stored format:  scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>
// Anything not matching that prefix is treated as a legacy PLAINTEXT password:
// it still verifies (so nobody is locked out mid-migration) but reports
// needsRehash so callers upgrade the record on next successful login.
const crypto = require('crypto')

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 64 * 1024 * 1024 // 128 * N * r = 16MB, plus headroom

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const dk = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$')
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// -> { ok: boolean, needsRehash: boolean }
function verifyPassword(password, stored) {
  if (!stored || password == null || password === '') return { ok: false, needsRehash: false }

  if (!isHashed(stored)) {
    const ok = safeEqual(password, stored)
    return { ok, needsRehash: ok }
  }

  const parts = String(stored).split('$')
  if (parts.length !== 6) return { ok: false, needsRehash: false }
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const dk = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    })
    const ok = dk.length === expected.length && crypto.timingSafeEqual(dk, expected)
    // Re-hash if the record was written with weaker parameters than we use today.
    return { ok, needsRehash: ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P) }
  } catch {
    return { ok: false, needsRehash: false }
  }
}

module.exports = { hashPassword, verifyPassword, isHashed }
