import fs from "fs"
import os from "os"
import path from "path"
import crypto from "node:crypto"
import OpenAI from "openai"
import "dotenv/config"

console.log("upsert-one file runs")

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID
const DRUPAL_JSONAPI_BASE = process.env.DRUPAL_JSONAPI_BASE

const sha = s => crypto.createHash("sha256").update(s).digest("hex")

async function listAllVsFiles() {
    const out = []
    let after
    while (true) {
        const page = await client.vectorStores.files.list(VECTOR_STORE_ID, { after })
        out.push(...page.data)
        if (!page.has_more) break
        after = page.data.at(-1).id
    }
    return out
}

export async function upsertOneNode({ bundle, uuid }) {
    // JSON:API single resource endpoint
    const url = `${DRUPAL_JSONAPI_BASE}/node/${bundle}/${uuid}?include=field_taglie`
    const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } })
    if (!res.ok) throw new Error(`JSON:API failed ${res.status} for ${url}`)

    const payload = await res.json()
    const item = payload.data
    if (!item?.type || !item?.id) throw new Error("Invalid JSON:API payload (missing data.type/id)")
    const key = `${item.type}:${item.id}`

    const included = payload.included || []
    const termNameById = new Map(
        included
            .filter(r => r.type.startsWith("taxonomy_term--"))
            .map(t => [t.id, t.attributes?.name])
    )

    // Hash only meaningful fields (avoid reindexing on metatag/revision noise)
    const taglieRefs = item.relationships?.field_taglie?.data || []

    const minimal = {
        type: item.type,
        id: item.id,
        title: item.attributes?.title,
        field_categoria: item.attributes?.field_categoria,
        field_materiale: item.attributes?.field_materiale,
        // field_prezzo: item.attributes?.field_prezzo,
        // field_valuta: item.attributes?.field_valuta,
        field_taglie: taglieRefs.map(ref => ({
            id: ref.id,
            name: termNameById.get(ref.id) || null
        }))
    }

    const content = JSON.stringify(minimal, null, 2)
    const hash = sha(content)

    const existing = await listAllVsFiles()
    const current = existing.find(f => f.attributes?.key === key)

    if (current && current.attributes?.hash === hash) {
        console.log("skip unchanged", key)
        return
    }

    // remove old VS file entry (method name may be .del or .delete depending on SDK)
    if (current) {
        const fileId = current.id  // this should be like "file-..."
        await client.vectorStores.files.delete(fileId, { vector_store_id: VECTOR_STORE_ID })
        console.log("removed old", key, fileId)
    }

    const tmpPath = path.join(os.tmpdir(), `vs-${item.type}-${item.id}.json`)
    fs.writeFileSync(tmpPath, content)

    const uploaded = await client.files.create({
        file: fs.createReadStream(tmpPath),
        purpose: "assistants"
    })

    await client.vectorStores.files.create(VECTOR_STORE_ID, {
        file_id: uploaded.id,
        attributes: { key, hash }
    })

    console.log("upserted", key)
}
