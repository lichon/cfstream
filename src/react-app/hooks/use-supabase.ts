'use client'

import { createClient } from '../libs/supabase'
import { useCallback, useEffect, useState } from 'react'

export interface ChatMessage {
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
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload) => {
        onChatMessage?.(payload.payload as ChatMessage)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          onChatMessage?.({ content: 'channel connected', timestamp: new Date().toISOString() })
          setIsConnected(true)
        }
      })

    setChannel(newChannel)

    return () => {
      supabase.removeChannel(newChannel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendChannelMessage = useCallback(
    async (content: string) => {
      if (!channel || !isChannelConnected) return

      const message: ChatMessage = {
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
