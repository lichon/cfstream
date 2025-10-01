import { Context } from 'hono'
import { createClient } from '@supabase/supabase-js'

export interface StreamRoom {
  id: string
  name: string
  secret: string
}

function getSupabase(c: Context) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
    db: { schema: 'public' }
  })
}

export async function getStreamRoom(c: Context, sid: string): Promise<StreamRoom | null> {
  const { data, error } = await getSupabase(c)
    .from('stream_rooms')
    .select('*')
    .eq('id', sid)
    .single()

  if (error) {
    console.error('Error fetching stream room:', error)
    return null
  }
  return data as StreamRoom
}

export async function getStreamRoomByName(c: Context, name: string): Promise<StreamRoom | null> {
  const { data, error } = await getSupabase(c)
    .from('stream_rooms')
    .select('*')
    .eq('name', name)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    console.error('Error fetching stream room:', error)
    return null
  }
  return data as StreamRoom
}

export async function newStreamRoom(c: Context, streamRoom: StreamRoom): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('stream_rooms')
    .upsert({ ...streamRoom })

  if (error) {
    console.error('Error create stream room:', error)
    return false
  }
  return true
}

export async function delStreamRoom(c: Context, sid: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('stream_rooms')
    .delete()
    .eq('id', sid)

  if (error) {
    console.error('Error setting stream room:', error)
    return false
  }
  return true
}

export async function getStreamSubs(c: Context, sid: string): Promise<Array<string>> {
  const { data, error } = await getSupabase(c)
    .from('stream_subs')
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
    .from('stream_subs')
    .upsert({ id: sid, sub_sid })

  if (error) {
    console.error('Error putting stream sub:', error)
    return false
  }
  return true
}

export async function delStreamSubs(c: Context, sid: string): Promise<boolean> {
  const { error } = await getSupabase(c)
    .from('stream_subs')
    .delete()
    .eq('id', sid)

  if (error) {
    console.error('Error deleting stream subs:', error)
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
