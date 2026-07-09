import { discardParked, retryParked } from '../lib/submit-queue'
import { useQueueState, useUnloadGuard } from '../lib/use-submit-queue'

// Mounted once, in _app. Owns the unload guard and is the only place a failed write
// is surfaced — the call sites stay unaware that their submit was queued.
export default function SyncStatus() {
  const { pending, parked } = useQueueState()
  useUnloadGuard(pending)

  if (!pending && !parked.length) return null

  return (
    <div className="sync-status" role="status" aria-live="polite">
      {pending > 0 && (
        <div className="sync-status-pill">
          <span className="btn-spinner" aria-hidden="true" />
          Saving {pending} change{pending === 1 ? '' : 's'}…
        </div>
      )}

      {parked.map(item => (
        <div key={item.id} className="sync-status-error" role="alert">
          <div className="sync-status-error-body">
            <strong>Couldn’t save: {item.label}</strong>
            <span>{item.error}</span>
          </div>
          <div className="sync-status-error-actions">
            <button className="btn-primary" onClick={() => retryParked(item.id)}>Retry</button>
            <button className="btn-ghost" onClick={() => discardParked(item.id)}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  )
}
