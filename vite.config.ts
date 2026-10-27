import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    // Component styles are injected into the shadow root they mount in, never into a separate .css file.
    svelte({ emitCss: false, compilerOptions: { css: "injected" } }),
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  define: {
    __CARD_VERSION__: JSON.stringify(pkg.version),
  },
  // Chunks are resolved relative to the card file, wherever HA serves it from (/hacsfiles/, /local/).
  base: "./",
  build: {
    target: "es2022",
    sourcemap: mode === "development",
    minify: mode !== "development",
    emptyOutDir: true,
    // No HTML entry, so no preload helper or polyfill is needed.
    modulePreload: false,
    copyPublicDir: false,
    rolldownOptions: {
      // Not library mode: that keeps whitespace in ES output for downstream bundlers,
      // but this file is the final bundle.
      input: "src/index.ts",
      output: {
        format: "es",
        entryFileNames: "camera-plus-card.js",
        // hls.js is only needed when WebRTC isn't available, so it's split off and lazy-loaded.
        chunkFileNames: "camera-plus-card-[name]-[hash].js",
      },
    },
  },
  preview: {
    cors: true,
  },
}));
