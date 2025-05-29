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
    {
      name: 'vite-custom-ws-cmd',
      configureServer(server) {
        server.httpServer?.on('request', (req) => {
          if (req.url.startsWith('/api/tts') && req.method === 'GET') {
            const queryString = req.url.split('?')[1] || '';
            const params = new URLSearchParams(queryString);
            const encodedTxt = params.get('txt');
            const decodedTxt = encodedTxt ? decodeURIComponent(encodedTxt) : '';
            if (decodedTxt) {
              server.ws.send('custom:tts', decodedTxt);
            }
          }
        });
      }
    }
  ],
});
