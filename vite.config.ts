import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Lists the code every screen needs (each page, what it imports and its styles) in
 * /offline-assets.json, so the app can fetch it all once and open any screen with no signal.
 * The PDF and Excel editors aren't on the list; they're kept once they've been opened.
 */
function offlineAssets(): Plugin {
  return {
    name: "northcroft-offline-assets",
    apply: "build",
    // After Vite has dropped chunks that only held styles.
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = new Set<string>();
      const visit = (name: string) => {
        const c = bundle[name];
        if (!c || files.has(name)) return;
        files.add(name);
        if (c.type !== "chunk") return;
        c.imports.forEach(visit);
        const meta = (c as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }).viteMetadata;
        meta?.importedCss?.forEach((f) => files.add(f));
        meta?.importedAssets?.forEach((f) => files.add(f));
      };
      for (const [name, c] of Object.entries(bundle)) {
        if (c.type !== "chunk") continue;
        if (c.isEntry || (c.isDynamicEntry && c.facadeModuleId && /[\\/]src[\\/]pages[\\/][^\\/]+\.tsx$/.test(c.facadeModuleId))) visit(name);
      }
      this.emitFile({
        type: "asset",
        fileName: "offline-assets.json",
        source: JSON.stringify({
          // Fetched ahead so every screen opens with no signal.
          files: [...files].filter((f) => f in bundle).sort().map((f) => `/${f}`),
          // Everything in this version, so the phone knows which older files it can let go.
          all: Object.keys(bundle).filter((f) => f.startsWith("assets/")).sort().map((f) => `/${f}`),
        }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineAssets()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          leaflet: ["leaflet", "react-leaflet"],
        },
      },
    },
  },
  server: { port: 5173, host: true },
});
