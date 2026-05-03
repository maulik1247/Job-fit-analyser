import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Same proxy for dev server and `vite preview` so `/api/*` hits Express on :8787 */
const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8787",
    changeOrigin: true,
    configure(proxy) {
      proxy.on("error", (err, _req, res) => {
        console.error(
          "\n[vite] /api proxy → :8787 failed:",
          err?.message || err,
          "\n    → Start the API: use `npm run dev` (runs `node server.js` + vite), or `node server.js` in another terminal.\n    → If you changed `server.js`, restart that process so routes stay in sync.\n"
        );
        if (res && !res.headersSent && typeof res.writeHead === "function") {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "API on :8787 is not running or failed. Use `npm run dev` or restart `node server.js`.",
            })
          );
        }
      });
    },
  },
};

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react()],
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
});
