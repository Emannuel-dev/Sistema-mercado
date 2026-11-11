import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';

export type ChaveConfig = 'prazo_vencimento_dias' | 'limite_fiado_padrao' | 'alerta_limite_percentual' | 'alerta_vencimento_dias' | 'sessao_minutos';

export async function lerConfig(chave: ChaveConfig, db: Db | typeof pool = pool): Promise<string> {
  const r = await db.query('SELECT valor FROM configuracoes WHERE chave = $1', [chave]);
  if (!r.rowCount) throw new Error(`Configuração ausente: ${chave}`);
  return r.rows[0].valor;
}
