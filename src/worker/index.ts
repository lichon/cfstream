import { Hono } from 'hono'

type Bindings = {
    KVASA: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/', (c) => c.json({ name: 'Cloudflare' }))

app.get('/api/kv/:key', async (c) => {
    console.log(c.env)
    console.log('123123')
    const key = c.req.param('key')
    const v = await c.env.KVASA.get(key)
    if (v) {
        return c.text(v)
    } else {
        return c.text(`error: Key ${key} not found`, 404)
    }
})

app.post('/api/session/:sid', async (c) => {
    const body = await c.req.json()
    const sid = c.req.param('sid')
    await c.env.KVASA.put(sid, body.offer)
})

export default app
