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

  backend.onmessage = ev => socket.send(ev.data)
  backend.onclose = ev => safeClose(socket, ev.code, ev.reason)
  backend.onerror = () => safeClose(socket, 1011, "backend websocket error")

  socket.onmessage = ev => backend.send(ev.data)
  socket.onclose = ev => safeClose(backend, ev.code, ev.reason)
  socket.onerror = () => safeClose(backend, 1011, "client websocket error")

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

