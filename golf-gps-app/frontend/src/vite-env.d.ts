/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TILE_URL?: string;
  readonly VITE_R2_BUCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
