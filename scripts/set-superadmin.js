/**
 * Generates the env values for the built-in superadmin account.
 *
 *   node scripts/set-superadmin.js '<new password>'
 *
 * Prints AUTH_SECRET (a fresh random one) and SUPERADMIN_PASSWORD_HASH. Paste both
 * into .env.local for development and into the deployment's environment for
 * production. The plaintext password is never stored anywhere.
 *
 * Rotating AUTH_SECRET invalidates every existing session — that is the intended
 * way to force everyone to sign in again.
 */
const crypto = require('crypto')
const { hashPassword } = require('../lib/password')

const password = process.argv[2]
if (!password) {
  console.error('Usage: node scripts/set-superadmin.js \'<new password>\'')
  process.exit(1)
}
if (password.length < 12) {
  console.error('Refusing: use at least 12 characters for the break-glass account.')
  process.exit(1)
}

const hash = hashPassword(password)

console.log('')
console.log('--- .env.local (dollar signs escaped: Next expands $VAR in env files) ---')
console.log('AUTH_SECRET=' + crypto.randomBytes(32).toString('base64'))
console.log('SUPERADMIN_USERNAME=admin')
console.log('SUPERADMIN_PASSWORD_HASH=' + hash.split('$').join('\\$'))
console.log('')
console.log('--- hosting dashboard (paste raw, no escaping) ---')
console.log(hash)
console.log('')
console.log('Keep AUTH_SECRET stable unless you want to sign everyone out.')
