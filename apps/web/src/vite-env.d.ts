/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Cyflow API. When unset, the app runs in local demo mode. */
  readonly VITE_CYFLOW_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
