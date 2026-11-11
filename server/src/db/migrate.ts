import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export async function migrar(log = true) {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migracoes (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const feitas = new Set((await pool.query('SELECT nome FROM _migracoes')).rows.map((r) => r.nome));
  for (const arq of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (feitas.has(arq)) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(readFileSync(join(dir, arq), 'utf8'));
      await c.query('INSERT INTO _migracoes (nome) VALUES ($1)', [arq]);
      await c.query('COMMIT');
      if (log) console.log(`migração aplicada: ${arq}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrar().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
