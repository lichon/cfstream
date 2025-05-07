import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { viteMockServe } from 'vite-plugin-mock';

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    viteMockServe({
      mockPath: 'mock',
      watchFiles: true,
    }),
  ],
});
