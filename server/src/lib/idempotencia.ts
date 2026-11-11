import { tx, pool, type Db } from '../db/pool.js';
import { buscarPorUuid, ehViolacaoUnica } from './transacoes.js';

export interface ResultadoOperacao<T> {
  repetida: boolean;
  transacao: any;
  dados?: T;
}

/**
 * Executa uma operação financeira identificada por UUID de forma idempotente (RN-12):
 * se a operação já foi registrada, devolve o registro existente em vez de duplicar.
 */
export async function executarIdempotente<T>(
  uuid: string,
  fn: (db: Db) => Promise<{ transacao: any; dados?: T }>,
): Promise<ResultadoOperacao<T>> {
  try {
    return await tx(async (db) => {
      const existente = await buscarPorUuid(db, uuid);
      if (existente) return { repetida: true, transacao: existente };
      const r = await fn(db);
      return { repetida: false, ...r };
    });
  } catch (e) {
    // Dois envios simultâneos do mesmo UUID: o segundo perde na restrição única.
    if (ehViolacaoUnica(e, 'transacoes_uuid_operacao_key')) {
      const c = await pool.connect();
      try {
        return { repetida: true, transacao: await buscarPorUuid(c, uuid) };
      } finally {
        c.release();
      }
    }
    throw e;
  }
}
