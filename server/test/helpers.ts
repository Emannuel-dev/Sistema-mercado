import { randomUUID } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { migrar } from '../src/db/migrate.js';
import { seedAdmin } from '../src/db/seed.js';
import { criarApp } from '../src/app.js';
import type { Contexto } from '../src/lib/contexto.js';

export async function bancoLimpo() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrar(false);
  await seedAdmin('admin123');
}

export async function ctxDe(perfil: 'administrador' | 'gerente' | 'operador'): Promise<Contexto> {
  const login = `${perfil}_${randomUUID().slice(0, 6)}`;
  const u = (await pool.query(
    `INSERT INTO usuarios (nome, login, senha_hash, perfil_id) SELECT $1,$1,'x',id FROM perfis WHERE nome=$2 RETURNING id, perfil_id`,
    [login, perfil])).rows[0];
  const perms = (await pool.query(
    `SELECT pe.codigo FROM perfis_permissoes pp JOIN permissoes pe ON pe.id = pp.permissao_id WHERE pp.perfil_id = $1`, [u.perfil_id])).rows;
  return { usuarioId: u.id, permissoes: new Set(perms.map((p) => p.codigo)), origem: 'online' };
}

export async function novoCliente(limite = 100, extra: Record<string, unknown> = {}) {
  const c = (await pool.query(
    `INSERT INTO clientes (nome, telefone, status) VALUES ($1,$2,$3) RETURNING *`,
    [extra.nome ?? 'Cliente Teste', extra.telefone ?? `1199${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`, extra.status ?? 'ativo'])).rows[0];
  await pool.query('INSERT INTO contas_fiado (cliente_id, limite) VALUES ($1,$2)', [c.id, limite]);
  return c;
}

export async function saldoConta(clienteId: string) {
  return (await pool.query('SELECT saldo_devedor FROM contas_fiado WHERE cliente_id = $1', [clienteId])).rows[0].saldo_devedor;
}

export const uuid = () => randomUUID();
export { pool, criarApp };
