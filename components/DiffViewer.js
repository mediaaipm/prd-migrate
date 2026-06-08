import { diffLines } from 'diff'
import { useMemo } from 'react'

function buildSplitColumns(chunks) {
  const left = []
  const right = []

  for (const chunk of chunks) {
    const lines = chunk.value.replace(/\n$/, '').split('\n')

    if (chunk.removed) {
      lines.forEach(l => left.push({ text: l, type: 'removed' }))
    } else if (chunk.added) {
      lines.forEach(l => right.push({ text: l, type: 'added' }))
    } else {
      // Pad the shorter side before adding unchanged lines
      while (left.length < right.length) left.push({ text: '', type: 'empty' })
      while (right.length < left.length) right.push({ text: '', type: 'empty' })
      lines.forEach(l => {
        left.push({ text: l, type: 'unchanged' })
        right.push({ text: l, type: 'unchanged' })
      })
    }
  }

  // Final pad
  while (left.length < right.length) left.push({ text: '', type: 'empty' })
  while (right.length < left.length) right.push({ text: '', type: 'empty' })

  return { left, right }
}

function buildUnifiedLines(chunks) {
  const lines = []
  for (const chunk of chunks) {
    const chunkLines = chunk.value.replace(/\n$/, '').split('\n')
    const type = chunk.added ? 'added' : chunk.removed ? 'removed' : 'unchanged'
    chunkLines.forEach(l => lines.push({ text: l, type }))
  }
  return lines
}

function DiffLine({ line, lineNumber, showPrefix }) {
  const prefix = showPrefix
    ? line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '
    : null

  return (
    <div className={`diff-line diff-line-${line.type}`}>
      <span className="diff-line-number">{line.type !== 'empty' ? lineNumber : ''}</span>
      <span className="diff-line-content">
        {prefix !== null && <span style={{ userSelect: 'none', opacity: 0.6 }}>{prefix}</span>}
        {line.text}
      </span>
    </div>
  )
}

export default function DiffViewer({ leftContent, rightContent, leftLabel, rightLabel, viewMode }) {
  const chunks = useMemo(
    () => diffLines(leftContent || '', rightContent || ''),
    [leftContent, rightContent]
  )

  const hasChanges = useMemo(() => chunks.some(c => c.added || c.removed), [chunks])

  const { left: leftLines, right: rightLines } = useMemo(
    () => (viewMode === 'split' ? buildSplitColumns(chunks) : { left: [], right: [] }),
    [chunks, viewMode]
  )

  const unifiedLines = useMemo(
    () => (viewMode === 'unified' ? buildUnifiedLines(chunks) : []),
    [chunks, viewMode]
  )

  if (!hasChanges) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
        No differences — the two documents are identical.
      </div>
    )
  }

  if (viewMode === 'split') {
    let leftNum = 0
    let rightNum = 0

    return (
      <div className="diff-container">
        <div className="diff-pane">
          <div className="diff-pane-label">{leftLabel}</div>
          {leftLines.map((line, i) => {
            if (line.type !== 'empty') leftNum++
            return <DiffLine key={i} line={line} lineNumber={line.type !== 'empty' ? leftNum : ''} showPrefix={false} />
          })}
        </div>
        <div className="diff-pane">
          <div className="diff-pane-label">{rightLabel}</div>
          {rightLines.map((line, i) => {
            if (line.type !== 'empty') rightNum++
            return <DiffLine key={i} line={line} lineNumber={line.type !== 'empty' ? rightNum : ''} showPrefix={false} />
          })}
        </div>
      </div>
    )
  }

  let lineNum = 0
  return (
    <div className="diff-container" style={{ flexDirection: 'column' }}>
      <div className="diff-pane" style={{ flex: 'none' }}>
        <div className="diff-pane-label">{leftLabel} → {rightLabel}</div>
        {unifiedLines.map((line, i) => {
          if (line.type !== 'removed') lineNum++
          return <DiffLine key={i} line={line} lineNumber={lineNum} showPrefix={true} />
        })}
      </div>
    </div>
  )
}
