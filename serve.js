// serve.js
import { createReverseProxyHandler } from "./reverse_proxy.js"
import { startTcpForwarders } from "./tcp_proxy.js"

const handler = await createReverseProxyHandler({
  configPath: "./domains.json"
})

// Raw TCP passthrough (e.g. shs net transport on :8008). Port-based, optional;
// no-op if tcp.json is absent.
const tcpCount = await startTcpForwarders({ configPath: "./tcp.json" })
if (tcpCount > 0) console.log(`Started ${tcpCount} raw TCP forwarder(s)`)

const cert = await Deno.readTextFile("/etc/letsencrypt/live/anproto.com/fullchain.pem")
const key  = await Deno.readTextFile("/etc/letsencrypt/live/anproto.com/privkey.pem")

console.log("Starting TLS reverse proxy on :443")

Deno.serve(
  {
    port: 443,
    cert,
    key
  },
  handler
)

