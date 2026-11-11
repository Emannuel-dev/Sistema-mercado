import type { Db } from '../db/pool.js';

export async function auditar(db: Db, usuarioId: string | null, acao: string, entidade: string, entidadeId: string | null, detalhes?: unknown) {
  await db.query(
    `INSERT INTO auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,$2,$3,$4,$5)`,
    [usuarioId, acao, entidade, entidadeId, detalhes === undefined ? null : JSON.stringify(detalhes)],
  );
}
