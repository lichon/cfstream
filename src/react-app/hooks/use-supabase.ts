'use client'

import { createClient } from '../lib/supabase'
import { useCallback, useEffect, useState } from 'react'
import { faker } from '@faker-js/faker'

type ChannelMessageType = 'message' | 'event' | 'presence';

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
const supabase = createClient()
const SELF_SENDER = 'Self'

export function useSupabaseChannel({ roomName, onChatMessage, onNotification }: ChannelConfig) {
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [initConnected, setInitConnected] = useState(false)
  const [isChannelConnected, setChannelConnected] = useState(false)
  const [onlineMembers, setOnlineMembers] = useState<ChannelMember[]>([])

  useEffect(() => {
    if (!roomName?.length) {
      return
    }
    const channel = supabase.channel(`room:${roomName}:messages`, {
      config: {
        broadcast: { self: true },
        private: false,
        presence: { key: 'id' },
      }
    })

    channel
      .on('broadcast', { event: 'message' }, (msg) => {
        if (fakeId === msg.payload.id) {
          msg.payload.sender = SELF_SENDER
        }
        onChatMessage?.(msg.payload as ChannelMessage)
      })
      .on('broadcast', { event: 'event' }, (msg) => {
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
        const connected = status === 'SUBSCRIBED'
        setChannelConnected(connected)
        if (!connected) {
          if (status === 'CHANNEL_ERROR') {
            setTimeout(() => {
              channel.subscribe();
            }, Math.floor(Math.random() * (4000)) + 1000)
          }
          return
        }
        // connected
        setInitConnected(true)
        await channel.track({
          id: fakeId,
          name: fakeName,
          image: `https://api.dicebear.com/7.x/thumbs/svg?seed=${fakeId}`
        })
      })

    setChannel(channel)

    return () => {
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line

  // add ui log on first connection
  useEffect(() => {
    if (initConnected) {
      onChatMessage?.({ content: `channel connected (${fakeName})` })
    }
  }, [initConnected]) // eslint-disable-line

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
