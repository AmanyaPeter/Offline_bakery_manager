import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          navigation: ["react", "react-dom", "react-router-dom"],
          database: ["dexie", "@supabase/supabase-js"],
          validation: ["zod"],
        },
      },
    },
  },
});
