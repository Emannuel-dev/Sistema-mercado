import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { naoEncontrado } from '../lib/erros.js';
import { autenticar, exigir, validar, zUuid, zValor } from '../lib/http.js';
import * as svc from './cartoes.service.js';

export async function cartoesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', autenticar);

  app.get('/cartoes', { preHandler: exigir('cartoes.ver') }, async (req) => {
    const q = validar(z.object({ busca: z.string().optional(), status: z.string().optional() }), req.query);
    const params: unknown[] = [];
    const cond: string[] = [];
    if (q.busca?.trim()) { params.push(`%${q.busca.trim().toLowerCase()}%`); cond.push(`(lower(k.identificador) LIKE $1 OR lower(c.nome) LIKE $1)`); }
    if (q.status) { params.push(q.status); cond.push(`k.status = $${params.length}`); }
    return (await pool.query(
      `SELECT k.*, c.nome AS cliente_nome, cc.valor_utilizado, cc.limite_liberado
         FROM cartoes_cliente k JOIN clientes c ON c.id = k.cliente_id
         LEFT JOIN ciclos_cartao cc ON cc.cartao_id = k.id AND cc.competencia = k.ciclo_atual
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY c.nome, k.criado_em DESC LIMIT 500`, params)).rows;
  });

  // RF-CAR-02 — consulta de saldo por identificador (balcão)
  app.get('/cartoes/consulta/:identificador', { preHandler: exigir('cartoes.ver') }, async (req) => {
    const { identificador } = validar(z.object({ identificador: z.string().min(1) }), req.params);
    const k = (await pool.query(
      `SELECT k.*, c.nome AS cliente_nome, c.status AS cliente_status, cc.valor_utilizado, cc.limite_liberado
         FROM cartoes_cliente k JOIN clientes c ON c.id = k.cliente_id
         LEFT JOIN ciclos_cartao cc ON cc.cartao_id = k.id AND cc.competencia = k.ciclo_atual
        WHERE k.identificador = $1`, [identificador.trim()])).rows[0];
    if (!k) throw naoEncontrado('Cartão');
    return k;
  });

  app.get('/cartoes/:id', { preHandler: exigir('cartoes.ver') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const k = (await pool.query(
      `SELECT k.*, c.nome AS cliente_nome FROM cartoes_cliente k JOIN clientes c ON c.id = k.cliente_id WHERE k.id = $1`, [id])).rows[0];
    if (!k) throw naoEncontrado('Cartão');
    const [ciclos, transacoes] = await Promise.all([
      pool.query('SELECT * FROM ciclos_cartao WHERE cartao_id = $1 ORDER BY competencia DESC', [id]),
      pool.query(`SELECT t.*, u.nome AS usuario_nome FROM transacoes t JOIN usuarios u ON u.id = t.usuario_id
                   WHERE t.cartao_id = $1 ORDER BY t.data_hora DESC LIMIT 200`, [id]),
    ]);
    return { ...k, ciclos: ciclos.rows, transacoes: transacoes.rows };
  });

  app.post('/cartoes', async (req, rep) => {
    const b = validar(z.object({
      cliente_id: zUuid, identificador: z.string().trim().min(1).max(50),
      limite_recorrente: z.number().min(0).max(1_000_000), dia_virada: z.number().int().min(1).max(28),
    }), req.body);
    rep.code(201);
    return svc.criarCartao(req.ctx, b);
  });

  app.post('/cartoes/compras', async (req, rep) => {
    const b = validar(z.object({
      uuid_operacao: zUuid, identificador: z.string().min(1), valor: zValor, descricao: z.string().max(500).nullish(),
    }), req.body);
    const r = await svc.compraCartao(req.ctx, b);
    rep.code(r.repetida ? 200 : 201);
    return r;
  });

  app.post('/cartoes/:id/status', async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ acao: z.enum(['bloquear', 'desbloquear', 'cancelar']), motivo: z.string().max(500).optional() }), req.body);
    return svc.alterarStatusCartao(req.ctx, id, b.acao, b.motivo);
  });

  app.put('/cartoes/:id', async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({
      limite_recorrente: z.number().min(0).max(1_000_000).optional(), dia_virada: z.number().int().min(1).max(28).optional(),
    }), req.body);
    return svc.alterarParametrosCartao(req.ctx, id, b);
  });

  app.post('/cartoes/:id/segunda-via', async (req, rep) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ novo_identificador: z.string().trim().min(1).max(50), motivo: z.string().trim().min(3) }), req.body);
    rep.code(201);
    return svc.segundaVia(req.ctx, id, b);
  });

  app.post('/cartoes/:id/virada', async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    return svc.viradaCartao(req.ctx, id);
  });

  app.post('/cartoes/viradas/processar', { preHandler: exigir('cartoes.virada') }, async () => svc.processarViradas());
}
