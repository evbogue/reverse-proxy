// serve.js
import { createReverseProxyHandler } from "./reverse_proxy.js"

const handler = await createReverseProxyHandler({
  configPath: "./domains.json"
})

const cert = await Deno.readTextFile("/etc/letsencrypt/live/anproto.com-0002/fullchain.pem")
const key  = await Deno.readTextFile("/etc/letsencrypt/live/anproto.com-0002/privkey.pem")

console.log("Starting TLS reverse proxy on :443")

Deno.serve(
  {
    port: 443,
    cert,
    key
  },
  handler
)

