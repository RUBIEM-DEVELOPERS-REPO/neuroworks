import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 7470,
    strictPort: true,
    open: "/dashboard",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7471",
        // changeOrigin: true rewrites the Host header to match the proxy
        // target (127.0.0.1:7471). Without this, the proxied request
        // carries the browser's Host (127.0.0.1:7470, the Vite dev port)
        // and the server's origin-guard rejects it with host_not_allowed
        // — because 127.0.0.1:7470 isn't in the API's allow-list.
        changeOrigin: true,
      },
    },
  },
});
