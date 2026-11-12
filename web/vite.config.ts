import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 127.0.0.1 e não "localhost": no Windows o Node pode resolver localhost para ::1 (IPv6)
// e a API escuta em IPv4, o que dava ECONNREFUSED e "Erro 500" na tela.
const API = process.env.API_URL ?? 'http://127.0.0.1:3333';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API,
        configure: (proxy) => {
          // API fora do ar: responde 503 com uma mensagem clara em vez de um 500 vazio.
          proxy.on('error', (_err, _req, res: any) => {
            if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ codigo: 'API_FORA_DO_AR', mensagem: `A API não está respondendo em ${API}. Rode "npm run dev" (ou "npm run dev:server") e confira o PostgreSQL.` }));
          });
        },
      },
    },
  },
});
