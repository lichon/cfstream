import { Context } from 'hono'
import { createClient } from '@supabase/supabase-js'

export interface SignalRoom {
  sid: string
  offer: string
  answer: string
}

function getSupabase(c: Context) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
    db: { schema: 'cfstream' }
  })
}

export async function getSignal(c: Context, id: string): Promise<SignalRoom | null> {
  const { data, error } = await getSupabase(c)
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching signal room:', error)
    return null
  }
  return data as SignalRoom
}

export async function setSignal(c: Context, signal: SignalRoom): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('signals')
    .upsert({ ...signal })

  if (error) {
    console.error('Error setting signal room:', error)
    return false
  }
  return true
}

export async function getStreamRoom(c: Context, name: string): Promise<string | null> {
  const { data, error } = await getSupabase(c)
    .from('rooms')
    .select('stream_id')
    .eq('name', name)
    .single()

  if (error) {
    console.error('Error fetching stream room:', error)
    return null
  }
  return data.stream_id
}

export async function setStreamRoom(c: Context, name: string, stream_id: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('rooms')
    .upsert({ name, stream_id })

  if (error) {
    console.error('Error setting stream room:', error)
    return false
  }
  return true
}

export async function getStreamSecret(c: Context, sid: string): Promise<string | null> {
  const { data, error } = await getSupabase(c)
    .from('secrets')
    .select('secret')
    .eq('id', sid)
    .single()

  if (error) {
    console.error('Error fetching stream secret:', error)
    return null
  }
  return data.secret
}

export async function setStreamSecret(c: Context, sid: string, secret: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('secrets')
    .upsert({ id: sid, secret })

  if (error) {
    console.error('Error setting stream secret:', error)
    return false
  }
  return true
}

export async function delStreamSecret(c: Context, sid: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('secrets')
    .delete()
    .eq('id', sid)

  if (error) {
    console.error('Error deleting stream secret:', error)
    return false
  }
  return true
}

export async function getStreamSubs(c: Context, sid: string): Promise<Array<string>> {
  const { data, error } = await getSupabase(c)
    .from('subs')
    .select('sub_sid')
    .eq('id', sid)
    .limit(100)

  if (error) {
    console.error('Error fetching stream subs:', error)
    return []
  }
  return data.map(x => x.sub_sid)
}

export async function putStreamSubs(c: Context, sid: string, sub_sid: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('subs')
    .upsert({ id: sid, sub_sid })

  if (error) {
    console.error('Error putting stream sub:', error)
    return false
  }
  return true
}

export async function delStreamSubs(c: Context, sid: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('subs')
    .delete()
    .eq('id', sid)

  if (error) {
    console.error('Error deleting stream secret:', error)
    return false
  }
  return true
}

export async function sendChannelMessage(c: Context, room: string, content: string): Promise<boolean> {
  if (!room?.length || !content?.length) {
    return false
  }
  const channel = getSupabase(c).channel(`room:${room}:messages`)
  await channel.send({
    type: 'broadcast',
    event: 'message',
    payload: {
      content,
      sender: 'channel',
      timestamp: new Date().toISOString(),
    },
  })
  return true
}
