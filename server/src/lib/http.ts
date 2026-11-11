import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { ErroNegocio, semPermissao } from './erros.js';
import type { Contexto } from './contexto.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Contexto;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

/** Resolve o dispositivo a partir do cabeçalho X-Dispositivo (identificação da instalação). */
async function dispositivoId(req: FastifyRequest): Promise<string | null> {
  const ident = String(req.headers['x-dispositivo'] ?? '').trim().slice(0, 100);
  if (!ident) return null;
  const nome = String(req.headers['x-dispositivo-nome'] ?? ident).slice(0, 100);
  const r = await pool.query(
    `INSERT INTO dispositivos (identificador, nome) VALUES ($1,$2)
     ON CONFLICT (identificador) DO UPDATE SET nome = EXCLUDED.nome RETURNING id, ativo`,
    [ident, nome],
  );
  if (!r.rows[0].ativo) throw new ErroNegocio('DISPOSITIVO_INATIVO', 'Este dispositivo foi desativado', 403);
  return r.rows[0].id;
}

/** preHandler: valida o token e carrega usuário + permissões do banco a cada requisição. */
export async function autenticar(req: FastifyRequest, _rep: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch (e) {
    if (process.env.DEBUG_AUTH) console.error(e);
    throw new ErroNegocio('NAO_AUTENTICADO', 'Sessão expirada ou inválida. Faça login novamente.', 401);
  }
  const r = await pool.query(
    `SELECT u.id, u.ativo, COALESCE(array_agg(pe.codigo) FILTER (WHERE pe.codigo IS NOT NULL), '{}') AS permissoes
       FROM usuarios u
       LEFT JOIN perfis_permissoes pp ON pp.perfil_id = u.perfil_id
       LEFT JOIN permissoes pe ON pe.id = pp.permissao_id
      WHERE u.id = $1 GROUP BY u.id`,
    [req.user.sub],
  );
  const u = r.rows[0];
  if (!u || !u.ativo) throw new ErroNegocio('NAO_AUTENTICADO', 'Usuário inativo', 401);
  req.ctx = { usuarioId: u.id, permissoes: new Set(u.permissoes), origem: 'online', dispositivoId: await dispositivoId(req) };
}

export const exigir = (perm: string) => async (req: FastifyRequest) => {
  if (!req.ctx.permissoes.has(perm)) throw semPermissao();
};

export function validar<T extends z.ZodTypeAny>(schema: T, dado: unknown): z.infer<T> {
  const r = schema.safeParse(dado);
  if (!r.success) {
    throw new ErroNegocio('DADOS_INVALIDOS', r.error.issues.map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`).join('; '), 400);
  }
  return r.data;
}

// Esquemas reutilizáveis
export const zValor = z.number().positive().max(1_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'máximo de 2 casas decimais');
export const zUuid = z.string().uuid();
export const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
