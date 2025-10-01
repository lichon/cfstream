'use client'

import { createClient } from '../libs/supabase'
import { useCallback, useEffect, useState } from 'react'

type ChannelMessageType = 'message' | 'notify' | 'rpc';

export interface ChannelMessage {
  id?: string
  type?: ChannelMessageType
  content: string | object
  timestamp: string
  sender?: string
}

interface ChannelConfig {
  roomName: string
  onNotification?: (msg: ChannelMessage) => void
  onChatMessage?: (msg: ChannelMessage) => void
}

const SELF_SENDER = 'Self'
const supabase = createClient()
const recentMessages: string[] = []

export function useSupabaseChannel({ roomName, onChatMessage, onNotification }: ChannelConfig) {
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
        sender: 'nickname',
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

  return { sendChannelMessage, isChannelConnected }
}
