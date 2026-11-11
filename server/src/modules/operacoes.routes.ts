import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { naoEncontrado } from '../lib/erros.js';
import { autenticar, exigir, validar, zUuid, zValor, zData } from '../lib/http.js';
import { hojeISO } from '../lib/datas.js';
import { registrarCompraFiado, registrarPagamento } from './fiado.service.js';
import { estornar } from './estornos.service.js';

export const zCompraFiado = z.object({
  uuid_operacao: zUuid,
  cliente_id: zUuid,
  valor: zValor,
  descricao: z.string().max(500).nullish(),
  vencimento: zData.nullish(),
  excecao_limite: z.boolean().optional(),
  justificativa: z.string().max(500).nullish(),
});

export const zPagamento = z.object({
  uuid_operacao: zUuid,
  cliente_id: zUuid,
  valor: zValor,
  meio_pagamento: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'outro']),
  observacao: z.string().max(500).nullish(),
  lancamento_ids: z.array(zUuid).optional(),
});

export async function operacoesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', autenticar);

  app.post('/fiado/compras', async (req, rep) => {
    const r = await registrarCompraFiado(req.ctx, validar(zCompraFiado, req.body));
    rep.code(r.repetida ? 200 : 201);
    return r;
  });

  app.post('/fiado/pagamentos', async (req, rep) => {
    const r = await registrarPagamento(req.ctx, validar(zPagamento, req.body));
    rep.code(r.repetida ? 200 : 201);
    return r;
  });

  // Débitos de fiado por situação (vencidos, a vencer, próximos do vencimento)
  app.get('/fiado/lancamentos', { preHandler: exigir('clientes.ver') }, async (req) => {
    const q = validar(z.object({
      situacao: z.enum(['vencido', 'a_vencer', 'aberto', 'quitado']).default('aberto'),
      cliente_id: zUuid.optional(),
      ate: zData.optional(),
    }), req.query);
    const hoje = hojeISO();
    const params: unknown[] = [hoje];
    const cond = [q.situacao === 'quitado' ? `l.status = 'quitado'` : `l.status = 'aberto'`];
    if (q.situacao === 'vencido') cond.push('l.vencimento < $1');
    if (q.situacao === 'a_vencer') cond.push('l.vencimento >= $1');
    if (q.ate) { params.push(q.ate); cond.push(`l.vencimento <= $${params.length}`); }
    if (q.cliente_id) { params.push(q.cliente_id); cond.push(`cf.cliente_id = $${params.length}`); }
    const r = await pool.query(
      `SELECT l.*, t.descricao, t.data_hora, c.id AS cliente_id, c.nome AS cliente_nome, c.telefone,
              GREATEST(($1::date - l.vencimento), 0) AS dias_atraso
         FROM lancamentos_fiado l JOIN contas_fiado cf ON cf.id = l.conta_id
         JOIN clientes c ON c.id = cf.cliente_id JOIN transacoes t ON t.id = l.transacao_id
        WHERE ${cond.join(' AND ')}
        ORDER BY l.vencimento, c.nome LIMIT 1000`,
      params,
    );
    return r.rows;
  });

  app.get('/transacoes', { preHandler: exigir('transacoes.ver') }, async (req) => {
    const q = validar(z.object({
      de: zData.optional(), ate: zData.optional(),
      cliente_id: zUuid.optional(), usuario_id: zUuid.optional(),
      tipo: z.enum(['compra_fiado', 'pagamento_fiado', 'compra_cartao', 'virada_cartao', 'estorno']).optional(),
      limite: z.coerce.number().int().min(1).max(1000).default(100),
    }), req.query);
    const params: unknown[] = [];
    const cond: string[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
    if (q.de) add('t.data_hora >= ?::date', q.de);
    if (q.ate) add(`t.data_hora < (?::date + 1)`, q.ate);
    if (q.cliente_id) add('t.cliente_id = ?', q.cliente_id);
    if (q.usuario_id) add('t.usuario_id = ?', q.usuario_id);
    if (q.tipo) add('t.tipo = ?', q.tipo);
    params.push(q.limite);
    const r = await pool.query(
      `SELECT t.*, c.nome AS cliente_nome, u.nome AS usuario_nome, k.identificador AS cartao_identificador
         FROM transacoes t JOIN clientes c ON c.id = t.cliente_id JOIN usuarios u ON u.id = t.usuario_id
         LEFT JOIN cartoes_cliente k ON k.id = t.cartao_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY t.data_hora DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows;
  });

  // Detalhe + dados de comprovante (RF-FIA-09)
  app.get('/transacoes/:id', { preHandler: exigir('transacoes.ver') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const t = (await pool.query(
      `SELECT t.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, u.nome AS usuario_nome,
              k.identificador AS cartao_identificador, p.meio_pagamento, p.observacao AS pagamento_observacao,
              l.vencimento, l.saldo_pendente, cf.saldo_devedor AS saldo_devedor_atual,
              e.id AS estorno_id, e.justificativa AS estorno_motivo, e.data_hora AS estorno_data
         FROM transacoes t JOIN clientes c ON c.id = t.cliente_id JOIN usuarios u ON u.id = t.usuario_id
         JOIN contas_fiado cf ON cf.cliente_id = c.id
         LEFT JOIN cartoes_cliente k ON k.id = t.cartao_id
         LEFT JOIN pagamentos p ON p.transacao_id = t.id
         LEFT JOIN lancamentos_fiado l ON l.transacao_id = t.id
         LEFT JOIN transacoes e ON e.referencia_transacao_id = t.id AND e.tipo = 'estorno'
        WHERE t.id = $1`, [id])).rows[0];
    if (!t) throw naoEncontrado('Transação');
    return t;
  });

  app.post('/transacoes/:id/estorno', async (req, rep) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ uuid_operacao: zUuid, motivo: z.string().trim().min(3, 'informe o motivo').max(500) }), req.body);
    const r = await estornar(req.ctx, id, b);
    rep.code(r.repetida ? 200 : 201);
    return r;
  });
}
