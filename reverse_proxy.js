// reverse_proxy.js

function safeClose(ws, code, reason) {
  let c = code
  if (c !== 1000 && !(c >= 3000 && c <= 4999)) {
    c = 1000
  }
  try {
    ws.close(c, reason)
  } catch (_) {}
}

async function loadDomainMap(configPath) {
  const text = await Deno.readTextFile(configPath)
  const data = JSON.parse(text)
  const map = new Map()

  for (const [domain, port] of Object.entries(data)) {
    map.set(domain.toLowerCase(), Number(port))
  }

  return map
}

function handleWebSocket(req, backendHost, url) {
  const { socket, response } = Deno.upgradeWebSocket(req)

  const backendUrl = `ws://${backendHost}${url.pathname}${url.search}`
  const backend = new WebSocket(backendUrl)

  const pending = []
  let backendOpen = false
  let closed = false
  const MAX_PENDING = 64

  function closeBoth(code, reason) {
    if (closed) return
    closed = true
    safeClose(socket, code, reason)
    safeClose(backend, code, reason)
  }

  function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
      return true
    }
    return false
  }

  backend.onopen = () => {
    backendOpen = true
    if (socket.readyState !== WebSocket.OPEN) {
      closeBoth(1001, "client not open")
      return
    }
    for (const msg of pending) {
      if (!safeSend(backend, msg)) break
    }
    pending.length = 0
  }
  backend.onmessage = ev => {
    if (!safeSend(socket, ev.data)) {
      closeBoth(1001, "client not open")
    }
  }
  backend.onclose = ev => closeBoth(ev.code, ev.reason)
  backend.onerror = () => closeBoth(1011, "backend websocket error")

  socket.onmessage = ev => {
    if (backendOpen && safeSend(backend, ev.data)) {
      return
    }
    if (pending.length >= MAX_PENDING) {
      closeBoth(1013, "backend websocket not ready")
    } else {
      pending.push(ev.data)
    }
  }
  socket.onclose = ev => closeBoth(ev.code, ev.reason)
  socket.onerror = () => closeBoth(1011, "client websocket error")

  return response
}

async function handleHttp(req, backendHost, url) {
  const forwardURL = `http://${backendHost}${url.pathname}${url.search}`

  const headers = new Headers(req.headers)
  headers.set("x-forwarded-proto", "https")
  headers.set("x-forwarded-host", url.hostname)
  headers.set("x-forwarded-port", "443")

  return fetch(forwardURL, {
    method: req.method,
    headers,
    body: req.body
  })
}

export async function createReverseProxyHandler({ configPath }) {
  const domainMap = await loadDomainMap(configPath)

  return async function (req) {
    const url = new URL(req.url)
    const hostname = url.hostname.toLowerCase()

    const backendPort = domainMap.get(hostname)
    if (!backendPort) {
      return new Response("Not Found", { status: 404 })
    }

    const backendHost = `localhost:${backendPort}`

    const isWebSocket =
      req.headers.get("upgrade")?.toLowerCase() === "websocket"

    if (isWebSocket) {
      return handleWebSocket(req, backendHost, url)
    }

    return handleHttp(req, backendHost, url)
  }
}
