import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// W trybie deweloperskim /api trafia do backendu uruchomionego lokalnie na porcie 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
