import { useState, useEffect } from 'react'
import SyncStatus from '../components/SyncStatus'
import '../styles/globals.css'

function LoginScreen({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [accountOptions, setAccountOptions] = useState(null)

  async function attemptLogin(selectedName) {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password, selectedName }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        localStorage.setItem('ss_auth', JSON.stringify(data.user))
        onLogin(data.user)
      } else if (res.ok && data.chooseAccount) {
        setAccountOptions(data.options)
      } else {
        setError(data.error || 'Invalid username or password.')
      }
    } catch {
      setError('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    attemptLogin()
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--sidebar-bg)', borderRadius: 12, padding: '40px 36px',
        display: 'flex', flexDirection: 'column', gap: 16, minWidth: 320,
        boxShadow: '0 8px 32px rgba(0,0,0,.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <img src="https://www.sanatansansaar.com/Bird.png" alt="logo" width={36} height={36} style={{ borderRadius: 6, objectFit: 'contain' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>Sanatan Sansaar</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Projects PRD</div>
          </div>
        </div>
        {accountOptions ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              This username has multiple accounts. Sign in as:
            </p>
            {accountOptions.map(opt => (
              <button
                key={opt.name}
                type="button"
                className="btn-primary"
                disabled={loading}
                onClick={() => attemptLogin(opt.name)}
                style={{ textAlign: 'left' }}
              >
                {opt.name} · <span style={{ opacity: 0.8, textTransform: 'capitalize' }}>{opt.role || 'user'}</span>
              </button>
            ))}
            {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={() => { setAccountOptions(null); setError('') }}
            >
              Back
            </button>
          </>
        ) : (
          <>
        <input
          className="form-input"
          placeholder="Username"
          autoComplete="username"
          value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          autoFocus
          required
        />
        <input
          className="form-input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          required
        />
        {error && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{error}</p>}
        <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
          </>
        )}
      </form>
    </div>
  )
}

export default function App({ Component, pageProps }) {
  const [authed, setAuthed] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)

  useEffect(() => {
    const raw = localStorage.getItem('ss_auth')
    if (!raw) { setAuthed(false); return }
    // Support legacy '1' value from old sessions
    if (raw === '1') {
      setCurrentUser({ name: 'Admin', username: 'admin', isAdmin: true, role: 'superadmin' })
      setAuthed(true)
    } else {
      try {
        setCurrentUser(JSON.parse(raw))
        setAuthed(true)
      } catch {
        setAuthed(false)
      }
    }
  }, [])

  function handleLogin(user) {
    setCurrentUser(user)
    setAuthed(true)
  }

  if (authed === null) return null
  if (!authed) return <LoginScreen onLogin={handleLogin} />
  return (
    <>
      <Component {...pageProps} currentUser={currentUser} />
      {/* Owns the unsaved-work guard and is the only surface for a failed write. */}
      <SyncStatus />
    </>
  )
}
