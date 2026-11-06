/** Shape of the build-time environment injected by Astro/Vite. */
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PUBLIC_API_BASE_URL?: string;
  readonly PUBLIC_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
