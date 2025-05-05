/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLAYER_HOST: string
  readonly VITE_API_HOST: string
  readonly VITE_VIDEO_BITRATE: number
  readonly VITE_OPEN_ON_SHARE: string
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}