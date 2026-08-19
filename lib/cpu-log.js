// Per-route CPU instrumentation, for sizing Vercel's Fluid Active CPU bill.
//
// Fluid bills *active CPU*, not wall clock: time the function spends parked on a
// redis roundtrip is free, time it spends in JSON.parse / JSON.stringify / hashing
// is not. That makes the usual duration metrics actively misleading here — a route
// can be slow and nearly free, or fast and expensive. `process.cpuUsage()` measures
// the thing that is actually billed.
//
// Enable by setting CPU_LOG=1 in the Vercel project's env vars, redeploy, exercise
// the app, then read the function logs. Leave it off the rest of the time: when the
// flag is unset `withCpuLog` returns the handler untouched, so there is no wrapper,
// no timers and no cost.
//
// Reading the output:
//
//   [cpu] GET /api/projects/foo/tasks cpu=64.2ms wall=310ms status=200
//   [cpu] GET /api/notifications cpu=3.1ms wall=88ms cold=1 boot=287.4ms status=200
//
//   cpu   — CPU burned inside the handler. This is the billable number. Multiply by
//           the route's share of invocations to find what is worth optimising.
//   wall  — elapsed time. cpu/wall well under 1 means redis-bound, i.e. already cheap.
//   cold  — first request served by this instance.
//   boot  — CPU the instance burned starting up (next runtime + module graph) before
//           the handler ran. Only meaningful on a cold line, and it is charged too.
//           If boot dwarfs cpu, the fix is fewer invocations, not faster handlers.

const ENABLED = process.env.CPU_LOG === '1'

// Set on the first request this instance serves, so the line can be attributed to a
// cold start and the bootstrap cost read off alongside it.
let served = 0

function ms(usage) {
  return (usage.user + usage.system) / 1000
}

function withCpuLog(handler, label) {
  if (!ENABLED) return handler

  return async function cpuLogged(req, res) {
    const cold = served === 0
    // Everything the process has burned up to this point is boot: requiring the next
    // runtime, this route's module graph, and the redis client construction.
    const boot = cold ? ms(process.cpuUsage()) : 0
    served++

    const cpu0 = process.cpuUsage()
    const wall0 = Date.now()
    try {
      return await handler(req, res)
    } finally {
      const cpu = ms(process.cpuUsage(cpu0))
      const wall = Date.now() - wall0
      const name = label || req.url
      const parts = [
        `[cpu] ${req.method} ${name}`,
        `cpu=${cpu.toFixed(1)}ms`,
        `wall=${wall}ms`,
      ]
      if (cold) parts.push('cold=1', `boot=${boot.toFixed(1)}ms`)
      parts.push(`status=${res.statusCode}`)
      console.log(parts.join(' '))
    }
  }
}

module.exports = { withCpuLog, CPU_LOG_ENABLED: ENABLED }
