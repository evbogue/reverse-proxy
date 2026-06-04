// tcp_proxy.js
//
// Raw TCP passthrough for protocols that are NOT HTTP/WebSocket — e.g. the
// SSB secret-handshake (shs) `net` transport on :8008.
//
// Unlike the HTTPS proxy, raw TCP carries no SNI / Host header, so there is
// nothing to route on by domain. Forwarding is therefore PORT-BASED: each
// public listen port maps 1:1 to a single backend "host:port". To expose more
// than one shs pub you need more than one public port.
//
// Config (tcp.json), listenPort -> upstream:
//   { "8008": "localhost:8108" }

async function loadTcpMap(configPath) {
  let text
  try {
    text = await Deno.readTextFile(configPath)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return new Map()
    throw err
  }

  const data = JSON.parse(text)
  const map = new Map()
  for (const [listenPort, upstream] of Object.entries(data)) {
    map.set(Number(listenPort), String(upstream))
  }
  return map
}

function parseUpstream(upstream) {
  const i = upstream.lastIndexOf(":")
  if (i === -1) throw new Error(`bad upstream, expected host:port: ${upstream}`)
  const hostname = upstream.slice(0, i) || "localhost"
  const port = Number(upstream.slice(i + 1))
  if (!Number.isInteger(port)) throw new Error(`bad upstream port: ${upstream}`)
  return { hostname, port }
}

// Pipe one direction; pipeTo half-closes the destination when the source ends,
// which preserves TCP half-close semantics the shs box-stream relies on.
async function pump(from, to) {
  try {
    await from.readable.pipeTo(to.writable)
  } catch (_) {
    // peer reset / already closed — nothing to do
  }
}

async function handleConn(client, upstreamAddr) {
  let upstream
  try {
    upstream = await Deno.connect(upstreamAddr)
  } catch (_) {
    try { client.close() } catch (_) {}
    return
  }

  await Promise.allSettled([
    pump(client, upstream),
    pump(upstream, client),
  ])

  try { client.close() } catch (_) {}
  try { upstream.close() } catch (_) {}
}

export async function startTcpForwarders({ configPath }) {
  const map = await loadTcpMap(configPath)

  let started = 0
  for (const [listenPort, upstream] of map) {
    const upstreamAddr = parseUpstream(upstream)

    let listener
    try {
      listener = Deno.listen({ port: listenPort })
    } catch (err) {
      // A busy/forbidden port must not take down the HTTPS server. The usual
      // cause is the backend daemon already owning this port (then it does not
      // need a forwarder at all) — log clearly and skip it.
      if (err instanceof Deno.errors.AddrInUse) {
        console.error(
          `TCP passthrough :${listenPort} SKIPPED — port already in use. ` +
            `If the daemon already binds :${listenPort} directly, remove it from tcp.json.`,
        )
      } else {
        console.error(`TCP passthrough :${listenPort} SKIPPED — ${err.message}`)
      }
      continue
    }

    started++
    console.log(
      `TCP passthrough :${listenPort} -> ${upstreamAddr.hostname}:${upstreamAddr.port}`,
    )

    ;(async () => {
      for await (const conn of listener) {
        handleConn(conn, upstreamAddr)
      }
    })()
  }

  return started
}
