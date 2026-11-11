import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { ErroNegocio } from '../lib/erros.js';
import { autenticar, validar } from '../lib/http.js';
import { lerConfig } from '../lib/configuracoes.js';

async function emitirToken(app: FastifyInstance, usuarioId: string) {
  const minutos = Number(await lerConfig('sessao_minutos'));
  return { token: app.jwt.sign({ sub: usuarioId }, { expiresIn: `${minutos}m` }), expira_em_minutos: minutos };
}

export async function perfilUsuario(id: string) {
  const r = await pool.query(
    `SELECT u.id, u.nome, u.login, u.trocar_senha, p.nome AS perfil,
            COALESCE(array_agg(pe.codigo ORDER BY pe.codigo) FILTER (WHERE pe.codigo IS NOT NULL), '{}') AS permissoes
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
       LEFT JOIN perfis_permissoes pp ON pp.perfil_id = p.id
       LEFT JOIN permissoes pe ON pe.id = pp.permissao_id
      WHERE u.id = $1 GROUP BY u.id, p.nome`,
    [id],
  );
  return r.rows[0];
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req) => {
    const b = validar(z.object({ login: z.string().min(1), senha: z.string().min(1) }), req.body);
    const r = await pool.query('SELECT id, senha_hash, ativo FROM usuarios WHERE login = $1', [b.login.trim().toLowerCase()]);
    const u = r.rows[0];
    // Mesma mensagem para usuário inexistente e senha errada.
    const ok = u && u.ativo && u.senha_hash !== '!' && (await bcrypt.compare(b.senha, u.senha_hash));
    if (!ok) throw new ErroNegocio('LOGIN_INVALIDO', 'Usuário ou senha inválidos', 401);
    await pool.query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [u.id]);
    await pool.query(`INSERT INTO auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'login','usuario',$2,$3)`,
      [u.id, u.id, JSON.stringify({ ip: req.ip, dispositivo: req.headers['x-dispositivo'] ?? null })]);
    return { ...(await emitirToken(app, u.id)), usuario: await perfilUsuario(u.id) };
  });

  // Renova a sessão enquanto o usuário está ativo (expiração por inatividade).
  app.post('/auth/renovar', { preHandler: autenticar }, async (req) => emitirToken(app, req.ctx.usuarioId));

  app.get('/auth/eu', { preHandler: autenticar }, async (req) => perfilUsuario(req.ctx.usuarioId));

  app.post('/auth/trocar-senha', { preHandler: autenticar }, async (req) => {
    const b = validar(z.object({ senha_atual: z.string(), nova_senha: z.string().min(8, 'mínimo de 8 caracteres') }), req.body);
    const u = (await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.ctx.usuarioId])).rows[0];
    if (!(await bcrypt.compare(b.senha_atual, u.senha_hash))) throw new ErroNegocio('SENHA_INCORRETA', 'Senha atual incorreta', 400);
    await pool.query('UPDATE usuarios SET senha_hash = $1, trocar_senha = FALSE WHERE id = $2',
      [await bcrypt.hash(b.nova_senha, 10), req.ctx.usuarioId]);
    await pool.query(`INSERT INTO auditoria_acoes (usuario_id, acao, entidade, entidade_id) VALUES ($1,'trocar_senha','usuario',$2)`, [req.ctx.usuarioId, req.ctx.usuarioId]);
    return { ok: true };
  });
}
