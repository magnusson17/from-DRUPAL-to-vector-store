import http from "node:http"
import "dotenv/config"
import { upsertOneNode } from "./upsert-one.js"

const PORT = process.env.PORT || 3001
const TOKEN = process.env.SYNC_TOKEN

http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/sync") {
        res.writeHead(404)
        return res.end("not found")
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401)
        return res.end("unauthorized")
    }

    let body = ""
    req.on("data", chunk => (body += chunk))
    req.on("end", async () => {
        try {
            const data = body ? JSON.parse(body) : {}

            console.log("payload", data)

            if (!data.bundle || !data.uuid) {
                throw new Error(`Missing bundle/uuid. Got bundle=${data.bundle} uuid=${data.uuid}`)
            }

            await upsertOneNode({ bundle: data.bundle, uuid: data.uuid })
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: true }))
        } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
    })
}).listen(PORT)
console.log("OK")
