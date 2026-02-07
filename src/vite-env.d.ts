/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEON_TOKEN: string
  readonly VITE_GAME_CONTRACT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}