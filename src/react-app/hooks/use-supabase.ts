'use client'

import { createClient } from '../libs/supabase'
import { useCallback, useEffect, useState } from 'react'

export interface ChatMessage {
  id?: string
  content: string
  timestamp: string
  sender?: string
}

interface ChannelConfig {
  roomName: string
  onChatMessage?: (msg: ChatMessage) => void
}

const EVENT_MESSAGE_TYPE = 'message'
const supabase = createClient()
const recentMessages: string[] = []

export function useSupabaseChannel({ roomName, onChatMessage }: ChannelConfig) {
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [isChannelConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!roomName?.length) {
      return
    }
    const newChannel = supabase.channel(`room:${roomName}:messages`, {
      config: { broadcast: { self: true }, private: false }
    })

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (msg) => {
        if (recentMessages.includes(msg.payload.id)) {
          msg.payload.sender = 'You'
        }
        onChatMessage?.(msg.payload as ChatMessage)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true)
        }
      })

    setChannel(newChannel)

    return () => {
      supabase.removeChannel(newChannel)
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
    async (content: string) => {
      if (!channel || !isChannelConnected) return

      const newMsgId = crypto.randomUUID()
      recentMessages.unshift(newMsgId)
      if (recentMessages.length > 10) {
        recentMessages.pop()
      }
      const message: ChatMessage = {
        id: newMsgId,
        content,
        sender: 'nickname',
        timestamp: new Date().toISOString(),
      }

      await channel.send({
        type: 'broadcast',
        event: EVENT_MESSAGE_TYPE,
        payload: message,
      })
    },
    [channel, isChannelConnected]
  )

  return { sendChannelMessage, isChannelConnected }
}
