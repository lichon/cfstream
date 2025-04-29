import { Hono } from 'hono'

type Bindings = {
    KVASA: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/', (c) => c.json({ name: 'Cloudflare' }))

app.get('/api/kv/:key', async (c) => {
    const key = c.req.param('key')
    const v = await c.env.KVASA.get(key)
    if (v) {
        return c.text(v)
    } else {
        return c.text(`Key not found`)
    }
})

app.put('/api/session/:sid', async (c) => {
    const body = await c.req.json()
    const sid = 'session_' + c.req.param('sid')
    await c.env.KVASA.put(sid, body)
})

app.get('/api/session/:sid', async (c) => {
    const sid = 'session_' + c.req.param('sid')
    return c.json(await c.env.KVASA.get(sid))
})

export default app
