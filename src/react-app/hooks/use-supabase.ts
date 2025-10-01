'use client'

import { createClient } from '../libs/supabase'
import { useCallback, useEffect, useState } from 'react'

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
}

interface ChannelConfig {
  roomName: string
  onNotification?: (msg: ChannelMessage) => void
  onChatMessage?: (msg: ChannelMessage) => void
}

// for test
const myId = window.location.pathname
const SELF_SENDER = 'Self'
const supabase = createClient()
const recentMessages: string[] = []

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
        if (recentMessages.includes(msg.payload.id)) {
          msg.payload.sender = SELF_SENDER
        }
        onChatMessage?.(msg.payload as ChannelMessage)
      })
      .on('broadcast', { event: 'notify' }, (msg) => {
        if (recentMessages.includes(msg.payload.id)) {
          msg.payload.sender = SELF_SENDER
        }
        onNotification?.(msg.payload as ChannelMessage)
      })
      .on('presence', { event: 'sync'}, () => {
        const newState = channel.presenceState<ChannelMember>()
        const newUsers = Array.from(
          Object.entries(newState).map(([key, values]) => [
            { id: key, name: values[0].name }
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
          name: myId
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
      onChatMessage?.({ content: `channel connected ${roomName}`, timestamp: new Date().toISOString() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChannelConnected])

  const sendChannelMessage = useCallback(
    async (content: string | object, type?: ChannelMessageType) => {
      if (!channel || !isChannelConnected) return

      const newMsgId = crypto.randomUUID()
      recentMessages.unshift(newMsgId)
      if (recentMessages.length > 10) {
        recentMessages.pop()
      }
      const message: ChannelMessage = {
        id: newMsgId,
        content,
        sender: myId,
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
