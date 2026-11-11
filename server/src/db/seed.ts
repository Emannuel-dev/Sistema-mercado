import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

/** Cria o primeiro administrador (login: admin). A senha deve ser trocada no primeiro acesso. */
export async function seedAdmin(senha = process.env.ADMIN_SENHA ?? 'admin123') {
  const hash = await bcrypt.hash(senha, 10);
  await pool.query(
    `INSERT INTO usuarios (nome, login, senha_hash, perfil_id, trocar_senha)
     SELECT 'Administrador', 'admin', $1, id, TRUE FROM perfis WHERE nome = 'administrador'
     ON CONFLICT (login) DO NOTHING`,
    [hash],
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAdmin().then(() => { console.log('usuário admin criado (senha inicial: admin123 ou ADMIN_SENHA)'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
