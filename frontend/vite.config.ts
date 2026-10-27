import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// W trybie deweloperskim /api trafia do backendu uruchomionego lokalnie na porcie 8000.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // biblioteki zmieniają się rzadko – osobne pakiety lepiej się buforują w przeglądarce
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          mantine: ["@mantine/core", "@mantine/hooks", "@mantine/notifications"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
