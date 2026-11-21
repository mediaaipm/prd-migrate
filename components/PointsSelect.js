import { FIBONACCI_POINTS, isFibonacciPoints } from '../lib/story-points'

// Story-point picker on the Fibonacci scale. An estimate saved before the scale keeps
// showing (marked) so opening and saving a card never changes it behind your back.
export default function PointsSelect({ value, onChange, className = 'form-input', placeholder = 'Unestimated', ...rest }) {
  const current = value === null || value === undefined ? '' : String(value)
  const legacy = current !== '' && !isFibonacciPoints(current)
  return (
    <select className={className} value={current} onChange={onChange} {...rest}>
      <option value="">{placeholder}</option>
      {legacy && <option value={current}>{current} (old estimate)</option>}
      {FIBONACCI_POINTS.map(p => <option key={p} value={String(p)}>{p} {p === 1 ? 'point' : 'points'}</option>)}
    </select>
  )
}
