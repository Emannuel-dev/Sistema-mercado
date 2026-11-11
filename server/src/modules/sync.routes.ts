import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { ErroNegocio } from '../lib/erros.js';
import { autenticar, validar, zUuid } from '../lib/http.js';
import { registrarCompraFiado, registrarPagamento } from './fiado.service.js';
import { zCompraFiado, zPagamento } from './operacoes.routes.js';

/**
 * Seção 11 — sincronização das operações registradas offline.
 * - O UUID da operação é único no servidor: reenvios devolvem o resultado anterior (RN-12).
 * - Limites, status e saldo são validados de novo no servidor (RN-13).
 * - Falha de regra de negócio vira "requer_revisao" com motivo; nunca sobrescreve saldo.
 */
export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', autenticar);

  const zOp = z.object({
    uuid_operacao: zUuid,
    tipo: z.enum(['compra_fiado', 'pagamento_fiado']),
    criado_em: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()),
  });

  app.post('/sync/operacoes', async (req) => {
    const b = validar(z.object({ operacoes: z.array(zOp).max(200) }), req.body);
    const resultados = [];
    for (const op of b.operacoes) {
      const ja = (await pool.query('SELECT status, erro FROM fila_sincronizacao WHERE uuid_operacao = $1', [op.uuid_operacao])).rows[0];
      if (ja && ja.status === 'sincronizada') {
        resultados.push({ uuid_operacao: op.uuid_operacao, status: 'sincronizada', repetida: true });
        continue;
      }
      // Data da operação: a do dispositivo, mas nunca no futuro.
      const criado = new Date(op.criado_em);
      const ctx = { ...req.ctx, origem: 'offline' as const, dataHora: criado > new Date() ? new Date() : criado };
      let status: 'sincronizada' | 'rejeitada' | 'requer_revisao';
      let erro: string | null = null;
      let transacao_id: string | null = null;
      try {
        const payload = { ...op.payload, uuid_operacao: op.uuid_operacao };
        const r = op.tipo === 'compra_fiado'
          ? await registrarCompraFiado(ctx, validar(zCompraFiado, payload))
          : await registrarPagamento(ctx, validar(zPagamento, payload));
        status = 'sincronizada';
        transacao_id = r.transacao.id;
      } catch (e) {
        if (e instanceof ErroNegocio) {
          status = e.codigo === 'DADOS_INVALIDOS' ? 'rejeitada' : 'requer_revisao';
          erro = `${e.codigo}: ${e.message}`;
        } else {
          throw e;
        }
      }
      await pool.query(
        `INSERT INTO fila_sincronizacao (uuid_operacao, dispositivo_id, usuario_id, tipo, payload, status, criado_em, sincronizado_em, erro)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6 = 'sincronizada' THEN now() END,$8)
         ON CONFLICT (uuid_operacao) DO UPDATE SET status = EXCLUDED.status, erro = EXCLUDED.erro,
           tentativas = fila_sincronizacao.tentativas + 1, sincronizado_em = EXCLUDED.sincronizado_em`,
        [op.uuid_operacao, req.ctx.dispositivoId ?? null, req.ctx.usuarioId, op.tipo, JSON.stringify(op.payload), status, op.criado_em, erro],
      );
      resultados.push({ uuid_operacao: op.uuid_operacao, status, erro, transacao_id });
    }
    if (req.ctx.dispositivoId) await pool.query('UPDATE dispositivos SET ultimo_sync = now() WHERE id = $1', [req.ctx.dispositivoId]);
    return { resultados };
  });

  // Dados mínimos para atendimento offline (cache local no dispositivo).
  app.get('/sync/snapshot', async (req) => {
    if (!req.ctx.permissoes.has('clientes.ver')) return { clientes: [], configuracoes: {} };
    const [clientes, cfg] = await Promise.all([
      pool.query(`SELECT c.id, c.nome, c.telefone, c.cpf, c.status, cf.limite, cf.saldo_devedor, cf.status AS credito_status
                    FROM clientes c JOIN contas_fiado cf ON cf.cliente_id = c.id WHERE c.status <> 'inativo'`),
      pool.query('SELECT chave, valor FROM configuracoes'),
    ]);
    return { gerado_em: new Date().toISOString(), clientes: clientes.rows,
      configuracoes: Object.fromEntries(cfg.rows.map((r) => [r.chave, r.valor])) };
  });

  // Operações que precisam de revisão (painel de sincronização).
  app.get('/sync/pendencias', async () =>
    (await pool.query(`SELECT f.*, d.nome AS dispositivo_nome, u.nome AS usuario_nome FROM fila_sincronizacao f
                         LEFT JOIN dispositivos d ON d.id = f.dispositivo_id LEFT JOIN usuarios u ON u.id = f.usuario_id
                        WHERE f.status <> 'sincronizada' ORDER BY f.criado_em DESC LIMIT 200`)).rows);
}
