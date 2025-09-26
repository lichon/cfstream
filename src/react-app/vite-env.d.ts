/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPEN_ON_SHARE: string
  readonly VITE_VIDEO_BITRATE: number
  readonly VITE_JITTER_BUFFER_TARGET: number
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}