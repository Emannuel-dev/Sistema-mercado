import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega .env simples (sem dependência extra).
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const linha of readFileSync(envPath, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mercadinho:mercadinho@localhost:5432/mercadinho',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao',
  port: Number(process.env.PORT ?? 3333),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  viradaIntervaloMs: Number(process.env.VIRADA_INTERVALO_MS ?? 60 * 60 * 1000),
};

export const USUARIO_SISTEMA_ID = '00000000-0000-0000-0000-000000000001';
