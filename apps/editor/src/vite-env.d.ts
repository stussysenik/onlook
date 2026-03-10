/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_ENABLE_ZIG_ACCELERATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
