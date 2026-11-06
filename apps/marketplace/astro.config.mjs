import path from "node:path";
import { defineConfig } from "astro/config";

/**
 * GitHub Pages build.
 *
 * Static output only: GitHub Pages serves files and nothing else, so every page
 * here is pre-rendered and fetches its data from the API in the browser.
 * `base` keeps every asset and internal link under the repository sub-path.
 */
export default defineConfig({
  site: "https://sufiyan-sabeel.github.io",
  base: "/aplora/",
  trailingSlash: "always",
  build: {
    format: "directory",
    assets: "_astro",
  },
  vite: {
    server: {
      // The shared packages are workspace symlinks, so Vite must read outside
      // the app directory.
      fs: { allow: [path.resolve(process.cwd(), "../..")] },
    },
  },
});
