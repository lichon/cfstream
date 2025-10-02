'use client'

import { createClient } from '../lib/supabase'
import { useCallback, useEffect, useState } from 'react'
import { faker } from '@faker-js/faker'

type ChannelMessageType = 'message' | 'notify' | 'presence';

export interface ChannelMessage {
  id?: string
  type?: ChannelMessageType
  content: string | object
  timestamp?: string
  sender?: string
}

interface ChannelMember {
  id: string
  name: string
  image: string
}

interface ChannelConfig {
  roomName: string
  onNotification?: (msg: ChannelMessage) => void
  onChatMessage?: (msg: ChannelMessage) => void
}

// for test
const fakeName = faker.person.firstName()
const fakeId = crypto.randomUUID()
const SELF_SENDER = 'Self'
const supabase = createClient()

export function useSupabaseChannel({ roomName, onChatMessage, onNotification }: ChannelConfig) {
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [isChannelConnected, setIsConnected] = useState(false)
  const [onlineMembers, setOnlineMembers] = useState<ChannelMember[]>([])

  useEffect(() => {
    if (!roomName?.length) {
      return
    }
    const channel = supabase.channel(`room:${roomName}:messages`, {
      config: {
        broadcast: { self: true },
        private: false
      }
    })

    channel
      .on('broadcast', { event: 'message' }, (msg) => {
        if (fakeId === msg.payload.id) {
          msg.payload.sender = SELF_SENDER
        }
        onChatMessage?.(msg.payload as ChannelMessage)
      })
      .on('broadcast', { event: 'notify' }, (msg) => {
        if (fakeId === msg.payload.id) {
          msg.payload.sender = SELF_SENDER
        }
        onNotification?.(msg.payload as ChannelMessage)
      })
      .on('presence', { event: 'sync'}, () => {
        const newState = channel.presenceState<ChannelMember>()
        const newUsers = Array.from(
          Object.entries(newState).map(([key, values]) => [
            { id: key, name: values[0].name, image: values[0].image }
          ][0])
        )
        setOnlineMembers(newUsers)
      })
      .on('presence', { event: 'join'}, (e) => {
        e.newPresences.map(p => {
          console.log(`${roomName} ${p.name} joined`)
        })
      })
      .on('presence', { event: 'leave'}, (e) => {
        e.leftPresences.map(p => {
          console.log(`${roomName} ${p.name} left`)
        })
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') {
          return
        }
        setIsConnected(true)
        await channel.track({
          name: fakeName,
          image: `https://api.dicebear.com/7.x/thumbs/svg?seed=${fakeId}`
        })
      })

    setChannel(channel)

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isChannelConnected) {
      onChatMessage?.({ content: `channel connected (${fakeName})` })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChannelConnected])

  const sendChannelMessage = useCallback(
    async (content: string | object, type?: ChannelMessageType) => {
      if (!channel || !isChannelConnected) return

      const message: ChannelMessage = {
        id: fakeId,
        content,
        sender: fakeName,
        timestamp: new Date().toISOString(),
      }

      await channel.send({
        type: 'broadcast',
        event: type || 'message',
        payload: message,
      })
    },
    [channel, isChannelConnected]
  )

  return { sendChannelMessage, isChannelConnected, onlineMembers }
}
