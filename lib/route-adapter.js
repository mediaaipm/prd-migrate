import { createHash } from 'crypto'
import { resolveSessionUser } from './session-live'

// Runs a Pages-style API handler — `handler(req, res)` — as an App Router route
// handler. Every route under app/api is a thin file that hands its handler to this.
//
// Why an adapter instead of rewriting 50 handlers against Request/Response: the
// handlers carry the auth, permission and lock logic, and each rewrite is a chance to
// change behaviour by accident. Keeping them byte-for-byte and reproducing the
// pages-router contract here confines the migration to one file that is easy to test.
//
// What is reproduced (next/dist/server/api-utils/node):
//   req.query   search params, with route params on top; a repeated key is an array
//   req.body    JSON (an empty body is {}), urlencoded → object, anything else → string;
//               1mb limit → 413, malformed JSON → 400 — same as the default bodyParser
//   res.json / res.send   JSON content type, Content-Length, and the automatic ETag
//               with a bodiless 304 when If-None-Match matches (lib/etag.js relies on it)
//   res.end     raw bytes, untouched (the media route streams images this way)
//   an uncaught throw → 500 "Internal Server Error"

const BODY_LIMIT = 1024 * 1024
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

class BodyError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function toQuery(searchParams, params) {
  const query = {}
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key)
    query[key] = all.length > 1 ? all : all[0]
  }
  return { ...query, ...(params || {}) }
}

function contentTypeOf(header) {
  return String(header || 'text/plain').split(';')[0].trim().toLowerCase()
}

async function readBody(request) {
  if (METHODS_WITHOUT_BODY.has(request.method)) return ''
  const buf = Buffer.from(await request.arrayBuffer())
  if (buf.length > BODY_LIMIT) throw new BodyError(413, 'Body exceeded 1mb limit')
  const text = buf.toString('utf8')
  const type = contentTypeOf(request.headers.get('content-type'))
  if (type === 'application/json' || type === 'application/ld+json') {
    if (text.length === 0) return {}
    try { return JSON.parse(text) } catch { throw new BodyError(400, 'Invalid JSON') }
  }
  if (type === 'application/x-www-form-urlencoded') {
    return toQuery(new URLSearchParams(text), null)
  }
  return text
}

// Next hashes the serialized body (fnv1a); any stable digest serves the same purpose.
function etagFor(payload) {
  const h = createHash('sha1').update(payload).digest('base64url').slice(0, 27)
  return `"${h}${Buffer.byteLength(payload).toString(36)}"`
}

function isFresh(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false
  if (ifNoneMatch.trim() === '*') return true
  const bare = t => t.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some(t => bare(t) === bare(etag))
}

function clientIp(headers) {
  const fwd = headers['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return headers['x-real-ip'] || '127.0.0.1'
}

function createRes(req) {
  const headers = new Map() // lowercased name → { name, value }
  const state = { done: false, body: null }

  const res = {
    statusCode: 200,
    statusMessage: undefined,
    get headersSent() { return state.done },
    get finished() { return state.done },
    get writableEnded() { return state.done },

    status(code) { res.statusCode = code; return res },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), { name, value }); return res },
    getHeader(name) { return headers.get(String(name).toLowerCase())?.value },
    getHeaders() { const o = {}; for (const [k, v] of headers) o[k] = v.value; return o },
    hasHeader(name) { return headers.has(String(name).toLowerCase()) },
    removeHeader(name) { headers.delete(String(name).toLowerCase()) },

    end(chunk) {
      if (state.done) return res
      state.done = true
      state.body = chunk === undefined || chunk === null ? null : chunk
      return res
    },

    send(body) {
      if (body === null || body === undefined) return res.end()
      if (res.statusCode === 204 || res.statusCode === 304) {
        res.removeHeader('Content-Type')
        res.removeHeader('Content-Length')
        res.removeHeader('Transfer-Encoding')
        return res.end()
      }
      const isJSONLike = ['object', 'number', 'boolean'].includes(typeof body) && !Buffer.isBuffer(body)
      const payload = isJSONLike ? JSON.stringify(body) : body
      const etag = etagFor(Buffer.isBuffer(payload) ? payload : String(payload))
      res.setHeader('ETag', etag)
      if (isFresh(req.headers['if-none-match'], etag)) {
        res.statusCode = 304
        return res.end()
      }
      if (Buffer.isBuffer(payload)) {
        if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Content-Length', String(payload.length))
        return res.end(payload)
      }
      if (isJSONLike) res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Length', String(Buffer.byteLength(payload)))
      return res.end(payload)
    },

    json(body) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.send(JSON.stringify(body))
    },

    redirect(statusOrUrl, url) {
      const [code, location] = typeof statusOrUrl === 'number' ? [statusOrUrl, url] : [307, statusOrUrl]
      res.statusCode = code
      res.setHeader('Location', location)
      return res.end()
    },
  }

  function toResponse(method) {
    const out = new Headers()
    for (const { name, value } of headers.values()) {
      if (Array.isArray(value)) value.forEach(v => out.append(name, String(v)))
      else if (value !== undefined) out.set(name, String(value))
    }
    const noBody = method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304
    return new Response(noBody ? null : state.body, { status: res.statusCode, statusText: res.statusMessage, headers: out })
  }

  return { res, state, toResponse }
}

export function adapt(handler) {
  return async function route(request, context) {
    const url = new URL(request.url)
    const params = context && context.params ? await context.params : {}
    const headers = Object.fromEntries(request.headers)

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      query: toQuery(url.searchParams, params),
      body: undefined,
      cookies: Object.fromEntries((headers.cookie || '').split(';').map(p => p.trim()).filter(Boolean).map(p => {
        const i = p.indexOf('=')
        const raw = p.slice(i + 1)
        try { return [p.slice(0, i), decodeURIComponent(raw)] } catch { return [p.slice(0, i), raw] }
      })),
      socket: { remoteAddress: clientIp(headers) },
    }
    req.connection = req.socket

    try {
      req.body = await readBody(request)
    } catch (e) {
      if (e instanceof BodyError) {
        return new Response(e.message, { status: e.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
      throw e
    }

    const { res, toResponse } = createRes(req)
    try {
      // Once per request: who this is *now* (role from Redis, revoked sessions refused).
      // getSessionUser() returns this, so no handler reads a stale role from the cookie.
      req.__sessionUser = await resolveSessionUser(req)
      await handler(req, res)
    } catch (e) {
      console.error(e)
      return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    return toResponse(request.method)
  }
}

// All the verbs a pages handler could answer. The handler itself decides — an
// unsupported method gets its own 405, exactly as before.
export function routeHandlers(handler) {
  const run = adapt(handler)
  return { GET: run, HEAD: run, POST: run, PUT: run, PATCH: run, DELETE: run, OPTIONS: run }
}
