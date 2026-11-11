import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { ErroNegocio, naoEncontrado } from '../lib/erros.js';
import { autenticar, exigir, validar, zUuid, zData } from '../lib/http.js';
import { auditar } from '../lib/auditoria.js';
import { lerConfig } from '../lib/configuracoes.js';
import { hojeISO, diasEntre } from '../lib/datas.js';
import { paraCentavos, paraReais } from '../lib/dinheiro.js';

const soDigitos = (s: string) => s.replace(/\D/g, '');
const vazioParaNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opc = (s: z.ZodTypeAny) => z.preprocess(vazioParaNull, s.nullable().optional());

const zCliente = z.object({
  nome: z.string().trim().min(2, 'informe o nome').max(150),
  telefone: z.string().transform(soDigitos).refine((t) => t.length >= 10 && t.length <= 11, 'telefone deve ter DDD + número'),
  cpf: z.preprocess(vazioParaNull, z.string().transform(soDigitos).refine((c) => c.length === 11, 'CPF deve ter 11 dígitos').nullable().optional()),
  data_nascimento: opc(zData),
  endereco: opc(z.string().max(200)),
  bairro: opc(z.string().max(100)),
  complemento: opc(z.string().max(100)),
  referencia: opc(z.string().max(200)),
  observacoes: opc(z.string().max(1000)),
});

const CAMPOS = ['nome', 'telefone', 'cpf', 'data_nascimento', 'endereco', 'bairro', 'complemento', 'referencia', 'observacoes'] as const;

/** Resumo financeiro do fiado: total devido, vencido e a vencer (RF-FIA-05, 06). */
export async function resumoFiado(clienteId: string) {
  const hoje = hojeISO();
  const r = await pool.query(
    `SELECT COALESCE(SUM(saldo_pendente),0) AS total,
            COALESCE(SUM(saldo_pendente) FILTER (WHERE vencimento < $2),0) AS vencido,
            COALESCE(SUM(saldo_pendente) FILTER (WHERE vencimento >= $2),0) AS a_vencer,
            MIN(vencimento) FILTER (WHERE vencimento < $2) AS vencimento_mais_antigo
       FROM lancamentos_fiado l JOIN contas_fiado c ON c.id = l.conta_id
      WHERE c.cliente_id = $1 AND l.status = 'aberto'`,
    [clienteId, hoje],
  );
  const x = r.rows[0];
  return {
    total: paraReais(paraCentavos(x.total)),
    vencido: paraReais(paraCentavos(x.vencido)),
    a_vencer: paraReais(paraCentavos(x.a_vencer)),
    dias_atraso: x.vencimento_mais_antigo ? diasEntre(x.vencimento_mais_antigo, hoje) : 0,
  };
}

export async function clientesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', autenticar);

  // RF-CLI-04 — pesquisa por nome, telefone, CPF ou identificador de cartão
  app.get('/clientes', { preHandler: exigir('clientes.ver') }, async (req) => {
    const q = validar(z.object({
      busca: z.string().optional(),
      status: z.enum(['ativo', 'inativo', 'bloqueado']).optional(),
      situacao: z.enum(['inadimplente', 'com_saldo']).optional(),
      limite: z.coerce.number().int().min(1).max(500).default(50),
      pagina: z.coerce.number().int().min(1).default(1),
    }), req.query);
    const params: unknown[] = [hojeISO()];
    const cond: string[] = [];
    if (q.busca?.trim()) {
      const b = q.busca.trim();
      params.push(`%${b.toLowerCase()}%`);
      const iNome = params.length;
      const dig = soDigitos(b);
      let extra = '';
      if (dig.length >= 3) { params.push(`%${dig}%`); extra = ` OR c.telefone LIKE $${params.length} OR c.cpf LIKE $${params.length}`; }
      params.push(b);
      extra += ` OR EXISTS (SELECT 1 FROM cartoes_cliente k WHERE k.cliente_id = c.id AND k.identificador = $${params.length})`;
      cond.push(`(lower(c.nome) LIKE $${iNome}${extra})`);
    }
    if (q.status) { params.push(q.status); cond.push(`c.status = $${params.length}`); }
    if (q.situacao === 'inadimplente') cond.push('COALESCE(v.vencido,0) > 0');
    if (q.situacao === 'com_saldo') cond.push('cf.saldo_devedor > 0');
    params.push(q.limite, (q.pagina - 1) * q.limite);
    const r = await pool.query(
      `SELECT c.id, c.nome, c.telefone, c.cpf, c.status, cf.limite, cf.saldo_devedor, cf.status AS credito_status,
              COALESCE(v.vencido,0) AS vencido, COUNT(*) OVER() AS total_registros
         FROM clientes c JOIN contas_fiado cf ON cf.cliente_id = c.id
         LEFT JOIN LATERAL (SELECT SUM(l.saldo_pendente) AS vencido FROM lancamentos_fiado l
                             WHERE l.conta_id = cf.id AND l.status = 'aberto' AND l.vencimento < $1) v ON TRUE
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY c.nome LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { itens: r.rows.map(({ total_registros, ...x }) => x), total: Number(r.rows[0]?.total_registros ?? 0) };
  });

  // RF-CLI-01/02/03/07 — cadastro com verificação de duplicidade
  app.post('/clientes', { preHandler: exigir('clientes.editar') }, async (req, rep) => {
    const b = validar(zCliente.extend({
      limite_fiado: z.number().min(0).max(1_000_000).optional(),
      confirmar_duplicidade: z.boolean().optional(),
    }), req.body);
    return tx(async (db) => {
      if (b.cpf) {
        const d = await db.query('SELECT id, nome FROM clientes WHERE cpf = $1', [b.cpf]);
        if (d.rowCount) throw new ErroNegocio('CPF_DUPLICADO', `CPF já cadastrado para ${d.rows[0].nome}`, 409, d.rows[0]);
      }
      if (!b.confirmar_duplicidade) {
        const d = await db.query('SELECT id, nome, telefone FROM clientes WHERE telefone = $1', [b.telefone]);
        if (d.rowCount) {
          throw new ErroNegocio('POSSIVEL_DUPLICIDADE',
            'Já existe cliente com este telefone. Confirme se é outra pessoa para continuar.', 409, d.rows);
        }
      }
      const limite = b.limite_fiado ?? Number(await lerConfig('limite_fiado_padrao', db));
      const c = (await db.query(
        `INSERT INTO clientes (${CAMPOS.join(',')}) VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        CAMPOS.map((k) => (b as any)[k] ?? null),
      )).rows[0];
      await db.query('INSERT INTO contas_fiado (cliente_id, limite) VALUES ($1,$2)', [c.id, paraReais(paraCentavos(limite))]);
      await auditar(db, req.ctx.usuarioId, 'criar_cliente', 'cliente', c.id, { nome: c.nome });
      rep.code(201);
      return c;
    });
  });

  // RF-CLI-05 — detalhe com histórico
  app.get('/clientes/:id', { preHandler: exigir('clientes.ver') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const c = (await pool.query(
      `SELECT c.*, cf.id AS conta_id, cf.limite, cf.saldo_devedor, cf.status AS credito_status
         FROM clientes c JOIN contas_fiado cf ON cf.cliente_id = c.id WHERE c.id = $1`, [id])).rows[0];
    if (!c) throw naoEncontrado('Cliente');
    const [cartoes, lancamentos, transacoes, fiado] = await Promise.all([
      pool.query(`SELECT * FROM cartoes_cliente WHERE cliente_id = $1 ORDER BY criado_em DESC`, [id]),
      pool.query(
        `SELECT l.*, t.descricao, t.data_hora, t.uuid_operacao FROM lancamentos_fiado l JOIN transacoes t ON t.id = l.transacao_id
          WHERE l.conta_id = $1 ORDER BY (l.status = 'aberto') DESC, l.vencimento LIMIT 200`, [c.conta_id]),
      pool.query(
        `SELECT t.*, u.nome AS usuario_nome, k.identificador AS cartao_identificador, p.meio_pagamento
           FROM transacoes t JOIN usuarios u ON u.id = t.usuario_id
           LEFT JOIN cartoes_cliente k ON k.id = t.cartao_id
           LEFT JOIN pagamentos p ON p.transacao_id = t.id
          WHERE t.cliente_id = $1 ORDER BY t.data_hora DESC LIMIT 200`, [id]),
      resumoFiado(id),
    ]);
    const hoje = hojeISO();
    return {
      ...c,
      fiado,
      cartoes: cartoes.rows,
      lancamentos: lancamentos.rows.map((l) => ({
        ...l, vencido: l.status === 'aberto' && l.vencimento < hoje,
        dias_atraso: l.status === 'aberto' && l.vencimento < hoje ? diasEntre(l.vencimento, hoje) : 0,
      })),
      transacoes: transacoes.rows,
    };
  });

  app.put('/clientes/:id', { preHandler: exigir('clientes.editar') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(zCliente, req.body);
    return tx(async (db) => {
      if (b.cpf) {
        const d = await db.query('SELECT nome FROM clientes WHERE cpf = $1 AND id <> $2', [b.cpf, id]);
        if (d.rowCount) throw new ErroNegocio('CPF_DUPLICADO', `CPF já cadastrado para ${d.rows[0].nome}`, 409);
      }
      const antes = (await db.query('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!antes) throw naoEncontrado('Cliente');
      const r = await db.query(
        `UPDATE clientes SET ${CAMPOS.map((k, i) => `${k} = $${i + 1}`).join(', ')}, atualizado_em = now()
          WHERE id = $${CAMPOS.length + 1} RETURNING *`,
        [...CAMPOS.map((k) => (b as any)[k] ?? null), id],
      );
      const mudou = Object.fromEntries(CAMPOS.filter((k) => String(antes[k] ?? '') !== String((b as any)[k] ?? '')).map((k) => [k, true]));
      await auditar(db, req.ctx.usuarioId, 'editar_cliente', 'cliente', id, { campos: Object.keys(mudou) });
      return r.rows[0];
    });
  });

  // RF-CLI-06 — status (mantém histórico)
  app.post('/clientes/:id/status', { preHandler: exigir('clientes.status') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ status: z.enum(['ativo', 'inativo', 'bloqueado']), motivo: z.string().trim().min(3, 'informe o motivo') }), req.body);
    return tx(async (db) => {
      const r = await db.query('SELECT status FROM clientes WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rowCount) throw naoEncontrado('Cliente');
      await db.query('UPDATE clientes SET status = $1, atualizado_em = now() WHERE id = $2', [b.status, id]);
      await auditar(db, req.ctx.usuarioId, 'alterar_status_cliente', 'cliente', id, { de: r.rows[0].status, para: b.status, motivo: b.motivo });
      return { id, status: b.status };
    });
  });

  // Limite e bloqueio do crédito de fiado (RF-FIA-07, 08)
  app.post('/clientes/:id/credito', { preHandler: exigir('fiado.limite') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({
      limite: z.number().min(0).max(1_000_000).optional(),
      status: z.enum(['ativa', 'bloqueada']).optional(),
      motivo: z.string().trim().min(3, 'informe o motivo'),
    }), req.body);
    return tx(async (db) => {
      const r = await db.query('SELECT * FROM contas_fiado WHERE cliente_id = $1 FOR UPDATE', [id]);
      if (!r.rowCount) throw naoEncontrado('Cliente');
      const conta = r.rows[0];
      const limite = b.limite !== undefined ? paraReais(paraCentavos(b.limite)) : conta.limite;
      const status = b.status ?? conta.status;
      await db.query('UPDATE contas_fiado SET limite = $1, status = $2 WHERE id = $3', [limite, status, conta.id]);
      await auditar(db, req.ctx.usuarioId, 'alterar_credito_fiado', 'cliente', id,
        { limite_anterior: conta.limite, limite_novo: limite, status_anterior: conta.status, status_novo: status, motivo: b.motivo });
      return { cliente_id: id, limite, status };
    });
  });
}
