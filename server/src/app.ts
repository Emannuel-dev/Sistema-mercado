import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import estaticos from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ErroNegocio } from './lib/erros.js';
import { authRoutes } from './modules/auth.routes.js';
import { clientesRoutes } from './modules/clientes.routes.js';
import { operacoesRoutes } from './modules/operacoes.routes.js';
import { cartoesRoutes } from './modules/cartoes.routes.js';
import { gestaoRoutes } from './modules/gestao.routes.js';
import { syncRoutes } from './modules/sync.routes.js';

/** Traduz falhas de conexão/estrutura do PostgreSQL em uma mensagem que o operador entende. */
export function problemaBanco(err: any): string | null {
  const c = err?.code ?? err?.errors?.[0]?.code;
  if (c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT' || c === '57P03')
    return 'O banco de dados (PostgreSQL) não está respondendo. Confira se ele está ligado e o DATABASE_URL no server/.env.';
  if (c === '28P01' || c === '28000') return 'O servidor não conseguiu entrar no PostgreSQL: usuário ou senha do DATABASE_URL incorretos.';
  if (c === '3D000') return 'O banco indicado no DATABASE_URL não existe. Crie-o (createdb mercadinho) e reinicie a API.';
  if (c === '42P01' || c === '42703') return 'O banco está desatualizado. Reinicie a API para aplicar as migrações (npm run migrate).';
  return null;
}

export async function criarApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: config.corsOrigin.split(','), allowedHeaders: ['Content-Type', 'Authorization', 'X-Dispositivo', 'X-Dispositivo-Nome'] });
  await app.register(jwt, { secret: config.jwtSecret });

  app.setErrorHandler((err: any, req, rep) => {
    if (err instanceof ErroNegocio) {
      return rep.code(err.status).send({ codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes });
    }
    if (err.statusCode && err.statusCode < 500) {
      return rep.code(err.statusCode).send({ codigo: 'REQUISICAO_INVALIDA', mensagem: err.message });
    }
    req.log.error(err);
    const banco = problemaBanco(err);
    if (banco) return rep.code(503).send({ codigo: 'BANCO_INDISPONIVEL', mensagem: banco });
    return rep.code(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' });
  });

  app.get('/saude', async () => ({ ok: true, hora: new Date().toISOString() }));
  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(clientesRoutes);
    await api.register(operacoesRoutes);
    await api.register(cartoesRoutes);
    await api.register(gestaoRoutes);
    await api.register(syncRoutes);
  }, { prefix: '/api' });

  // Em produção, o próprio servidor entrega o front-end compilado (web/dist).
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (existsSync(web)) {
    await app.register(estaticos, { root: web });
    app.setNotFoundHandler((req, rep) =>
      req.url.startsWith('/api') ? rep.code(404).send({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada' }) : rep.sendFile('index.html'));
  }
  return app;
}
