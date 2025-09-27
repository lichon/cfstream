
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
    isMobilePlatform: boolean
    cmdList: Set<string>
    rpcList: Set<string>
  }
  debug: boolean
}

const defaultConfig: AppConfig = {
  api: {
    host: window.location.host,
    roomUrl: '/api/rooms',
    sessionUrl: '/api/sessions',
    stunServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
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
    selfDisplayName: 'You',
    maxHistoryMessage: 1000,
    openLinkOnShare: ['true', '1'].includes(import.meta.env.VITE_OPEN_ON_SHARE),
    isMobilePlatform: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    cmdList: new Set<string>([
      '/?',
      '/debug',
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
    rpcList: new Set<string>(['fetch', 'tts']),
  },
  debug: import.meta.env.DEV
}

export function getConfig(): AppConfig {
  return defaultConfig
}

export function updateConfig(newConfig: Partial<AppConfig>): void {
  Object.assign(defaultConfig, newConfig)
}