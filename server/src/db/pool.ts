import pg from 'pg';
import { config } from '../config.js';

// DATE volta como string AAAA-MM-DD (sem conversão de fuso).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

// Se o PostgreSQL reiniciar ou cair, conexões ociosas emitem 'error'. Sem este handler o Node
// derruba a API inteira; com ele, a API continua no ar e reconecta quando o banco voltar.
pool.on('error', (e) => console.error('[mercadinho] conexão com o PostgreSQL perdida:', e.message));

export type Db = pg.PoolClient;

/** Executa fn dentro de uma transação SQL. Faz rollback em qualquer erro. */
export async function tx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}
