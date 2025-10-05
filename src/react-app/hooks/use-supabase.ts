'use client'

import { createClient } from '../lib/supabase'
import { useCallback, useEffect, useState } from 'react'
import { faker } from '@faker-js/faker'

type ChannelMessageType = 'message' | 'event' | 'command'

type ChannelRequestMethod = 'ping' | 'connect'

export interface ChannelRequest {
  tid?: string
  method: ChannelRequestMethod
  params?: unknown
}

export interface ChannelResponse {
  tid?: string
  data?: unknown
  error?: string
}

export interface ChannelMessage {
  id?: string // message sender id
  type?: ChannelMessageType
  content: unknown // updated type
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
  onChannelEvent?: (msg: ChannelMessage) => void
  onChannelRequest?: (req: ChannelRequest) => Promise<unknown>
  onChatMessage?: (msg: ChannelMessage) => void
}

const fakeName = faker.person.firstName()
const fakeId = crypto.randomUUID()
const supabase = createClient()
const SELF_SENDER = 'Self'

// cache of outgoing requests' resolvers
const outgoingRequests = new Map<string, { resolve: (data: unknown) => void, reject: (err: Error) => void }>()

export function useSupabaseChannel(config: ChannelConfig) {
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [initConnected, setInitConnected] = useState(false)
  const [isChannelConnected, setChannelConnected] = useState(false)
  const [onlineMembers, setOnlineMembers] = useState<ChannelMember[]>([])

  useEffect(() => {
    if (!config.roomName?.length) {
      return
    }
    const channel = supabase.channel(`room:${config.roomName}:messages`, {
      config: {
        broadcast: { self: true },
        presence: { key: fakeId },
        private: false,
      }
    })

    channel
      .on('broadcast', { event: 'message' }, (msg) => {
        if (fakeId === msg.payload.id) {
          msg.payload.sender = SELF_SENDER
        }
        config.onChatMessage?.(msg.payload as ChannelMessage)
      })
      .on('broadcast', { event: 'event' }, (msg) => {
        if (fakeId === msg.payload.id) {
          msg.payload.sender = SELF_SENDER
        }
        config.onChannelEvent?.(msg.payload as ChannelMessage)
      })
      .on('broadcast', { event: 'command' }, (msg) => {
        channelCommandHandler(msg.payload as ChannelMessage, channel)
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
          console.log(`${p.name} joined`)
        })
      })
      .on('presence', { event: 'leave'}, (e) => {
        e.leftPresences.map(p => {
          console.log(`${p.name} left`)
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
      config.onChatMessage?.({ content: `channel connected (${fakeName})` })
    }
  }, [initConnected]) // eslint-disable-line

  const newMessage = function (content: string | object): ChannelMessage {
    const message: ChannelMessage = {
      id: fakeId,
      content: content,
      sender: fakeName,
      timestamp: new Date().toISOString(),
    }
    return message
  }

  const channelCommandHandler = async (cmd: ChannelMessage, ch: typeof channel) => {
    const req = cmd.content as ChannelRequest
    if (fakeId === cmd.id) {
      // ignore commands from self
      return
    }
    if (!req.method?.length) {
      const res = cmd.content as ChannelResponse
      const handlers = outgoingRequests.get(res.tid!)
      if (!handlers) {
        return
      }
      console.log('recvChannelResponse', cmd.content)
      if (res.error) {
        handlers.reject(new Error(res.error))
      } else {
        handlers.resolve(res.data)
      }
      return
    }

    switch (req.method) {
      case 'ping':
        sendChannelResponse({ tid: req.tid, data: 'pong' }, ch)
        break
      default:
        try {
          const res = await config.onChannelRequest?.(req)
          if (!res)
            return
          console.log('handleChannelRequest', req)
          sendChannelResponse({ tid: req.tid, data: res }, ch)
        } catch (e) {
          const error = e instanceof Error ? e.message : 'unknown error'
          sendChannelResponse({ tid: req.tid, error }, ch)
        }
        break
    }
  }

  const sendChannelResponse = async (res: ChannelResponse, ch: typeof channel) => {
    console.log('sendChannelResponse', res)
    await ch?.send({
      type: 'broadcast',
      event: 'command',
      payload: newMessage(res),
    })
  }

  const sendChannelRequest = useCallback(
    async (req: ChannelRequest): Promise<ChannelResponse> => {
      if (!req.tid?.length) {
        req.tid = crypto.randomUUID()
      }
      const tid = req.tid

      if (!channel || !isChannelConnected) {
        return { error: 'channel not connected' } as ChannelResponse
      }

      let timeoutId: NodeJS.Timeout
      const response = new Promise((resolve, reject) => {
        outgoingRequests.set(tid, { resolve, reject })
        timeoutId = setTimeout(() => {
          reject(new Error('timeout'))
        }, 5000)
      })

      console.log('sendChannelRequest', req)
      await channel.send({
        type: 'broadcast',
        event: 'command',
        payload: newMessage(req),
      })

      try {
        const data = await response
        clearTimeout(timeoutId!)
        return { data } as ChannelResponse
      } catch (e) {
        const error = e instanceof Error ? e.message : 'unknown error'
        return { error } as ChannelResponse
      } finally {
        console.log('ChannelRequest done', tid)
        outgoingRequests.delete(tid)
      }
    },
    [channel, isChannelConnected]
  )

  const sendChannelMessage = useCallback(
    async (content: string | object, type?: ChannelMessageType) => {
      if (!channel || !isChannelConnected)
        return

      const message = newMessage(content)
      await channel.send({
        type: 'broadcast',
        event: type || 'message',
        payload: message,
      })
    },
    [channel, isChannelConnected]
  )

  return {
    sendChannelMessage,
    sendChannelRequest,
    isChannelConnected,
    onlineMembers
  }
}
