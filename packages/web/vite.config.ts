import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 3000,
    proxy: {
      "/socket.io": {
        target: BACKEND_URL,
        ws: true,
      },
      "/api": {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
});
