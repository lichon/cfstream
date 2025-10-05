'use client'

// Polyfill for crypto.randomUUID
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    // A simple fallback for non-secure contexts
    // See: https://stackoverflow.com/a/2117523
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
      (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    ) as `${string}-${string}-${string}-${string}-${string}`
  }
}

interface IceServer {
  urls: string,
}

export interface AppConfig {
  api: {
    host: string
    roomUrl: string
    sessionUrl: string
    stunServers: IceServer[]
  }
  stream: {
    broadcastInterval: number
    jitterBufferTarget: number
    videoBitrate: number
    broadcastLabel: string
    signalLabel: string
  }
  ui: {
    ttsEnabled: boolean
    streamOwnerDisplayName: string
    selfDisplayName: string
    maxHistoryMessage: number
    openLinkOnShare: boolean
    shareLinkHost: string
    isMobilePlatform: boolean
    cmdList: Set<string>
  }
  debug: boolean
}

const defaultConfig: AppConfig = {
  api: {
    host: window.location.host,
    roomUrl: '/api/rooms',
    sessionUrl: '/api/sessions',
    stunServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  },
  stream: {
    broadcastInterval: 5000,
    jitterBufferTarget: Number(import.meta.env.VITE_JITTER_BUFFER_TARGET) || 500,
    videoBitrate: Number(import.meta.env.VITE_VIDEO_BITRATE) || 1000000,
    broadcastLabel: 'broadcast',
    signalLabel: 'signal',
  },
  ui: {
    ttsEnabled: true,
    streamOwnerDisplayName: 'Owner',
    selfDisplayName: 'Self',
    maxHistoryMessage: 1000,
    openLinkOnShare: ['true', '1'].includes(import.meta.env.VITE_OPEN_ON_SHARE),
    shareLinkHost: import.meta.env.VITE_SHARE_LINK_HOST,
    isMobilePlatform: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    cmdList: new Set<string>([
      '/?',
      '/debug',
      '/t',
      '/test',
      '/buffer',
      '/clear',
      '/c',
      '/hide',
      '/h',
      '/log',
      '/l',
      '/mute',
      '/m',
      '/f',
      '/fullscreen',
      '/pip',
      '/input',
      '/rinput',
      '/tts',
      '/volumeUp',
      '/vu',
      '/volumeDown',
      '/vd',
    ]),
  },
  debug: import.meta.env.DEV
}

export function getConfig(): AppConfig {
  return defaultConfig
}

export function updateConfig(newConfig: Partial<AppConfig>): void {
  Object.assign(defaultConfig, newConfig)
}