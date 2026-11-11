import type { Db } from '../db/pool.js';
import type { Contexto } from './contexto.js';

export interface NovaTransacao {
  uuidOperacao: string;
  clienteId: string;
  cartaoId?: string | null;
  tipo: 'compra_fiado' | 'pagamento_fiado' | 'compra_cartao' | 'virada_cartao' | 'estorno';
  valor: string; // NUMERIC em reais
  descricao?: string | null;
  referenciaId?: string | null;
  justificativa?: string | null;
  excecaoLimite?: boolean;
  competencia?: string | null;
}

/** Grava uma movimentação no livro de transações (RN-01). */
export async function inserirTransacao(db: Db, ctx: Contexto, t: NovaTransacao) {
  const r = await db.query(
    `INSERT INTO transacoes (uuid_operacao, cliente_id, cartao_id, tipo, valor, descricao, data_hora, usuario_id,
                             dispositivo_id, origem, referencia_transacao_id, justificativa, excecao_limite, competencia)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [t.uuidOperacao, t.clienteId, t.cartaoId ?? null, t.tipo, t.valor, t.descricao ?? null, ctx.dataHora ?? null,
     ctx.usuarioId, ctx.dispositivoId ?? null, ctx.origem, t.referenciaId ?? null, t.justificativa ?? null,
     t.excecaoLimite ?? false, t.competencia ?? null],
  );
  return r.rows[0];
}

/** Retorna a transação já registrada com este UUID (reenvio idempotente, RN-12). */
export async function buscarPorUuid(db: Db, uuid: string) {
  const r = await db.query('SELECT * FROM transacoes WHERE uuid_operacao = $1', [uuid]);
  return r.rows[0] ?? null;
}

export const ehViolacaoUnica = (e: any, constraint?: string) =>
  e?.code === '23505' && (!constraint || e?.constraint === constraint);
