import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createReadStream, readFileSync } from "node:fs";

/**
 * The drawing viewer's background workers: the DWG reader (with its 11 MB engine, which it loads
 * from next to itself) and the CAD text layout worker. They're copied as they are into a folder
 * named after the viewer's version, so a new version never mixes with files a phone has kept.
 * They load only when a drawing is opened; nothing here is fetched ahead for no-signal use.
 */
const CAD_DIR = "cad/1.7.6-3.15.16";
const CAD_FILES: Record<string, string> = {
  "libredwg-parser-worker.js": "node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js",
  "libredwg-web.wasm": "node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm",
  "mtext-renderer-worker.js": "node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js",
};

function cadAssets(): Plugin {
  return {
    name: "northcroft-cad-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith(`/${CAD_DIR}/`) ? req.url.slice(CAD_DIR.length + 2).split("?")[0] : "";
        const file = name ? CAD_FILES[name] : undefined;
        if (!file) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(CAD_FILES)) {
        this.emitFile({ type: "asset", fileName: `${CAD_DIR}/${name}`, source: readFileSync(file) });
      }
    },
  };
}

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
  plugins: [react(), offlineAssets(), cadAssets()],
  define: { __CAD_BASE__: JSON.stringify(`/${CAD_DIR}/`) },
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
