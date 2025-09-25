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
