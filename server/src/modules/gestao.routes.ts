import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { ErroNegocio, naoEncontrado } from '../lib/erros.js';
import { autenticar, exigir, validar, zUuid, zData } from '../lib/http.js';
import { auditar } from '../lib/auditoria.js';
import { hojeISO, somarDias } from '../lib/datas.js';
import { lerConfig } from '../lib/configuracoes.js';
import { USUARIO_SISTEMA_ID } from '../config.js';

export async function gestaoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', autenticar);

  // ---------------- Dashboard (4.4 e seção 12) ----------------
  app.get('/dashboard', { preHandler: exigir('dashboard.ver') }, async (req) => {
    const hoje = hojeISO();
    const q = validar(z.object({ de: zData.default(somarDias(hoje, -29)), ate: zData.default(hoje) }), req.query);
    const [clientes, fiado, cartoes, mov, serie, alertasVenc, alertasLimite] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='ativo') AS ativos,
                         COUNT(*) FILTER (WHERE status='bloqueado') AS bloqueados, COUNT(*) FILTER (WHERE status='inativo') AS inativos
                    FROM clientes`),
      pool.query(`SELECT COALESCE(SUM(saldo_pendente),0) AS em_aberto,
                         COALESCE(SUM(saldo_pendente) FILTER (WHERE vencimento < $1),0) AS vencido,
                         COALESCE(SUM(saldo_pendente) FILTER (WHERE vencimento >= $1),0) AS a_vencer,
                         COUNT(DISTINCT conta_id) FILTER (WHERE vencimento < $1) AS inadimplentes
                    FROM lancamentos_fiado WHERE status = 'aberto'`, [hoje]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE k.status='ativo') AS ativos, COUNT(*) FILTER (WHERE k.status='bloqueado') AS bloqueados,
                         COALESCE(SUM(cc.valor_utilizado) FILTER (WHERE k.status IN ('ativo','bloqueado')),0) AS credito_utilizado,
                         COALESCE(SUM(k.saldo) FILTER (WHERE k.status='ativo'),0) AS saldo_disponivel
                    FROM cartoes_cliente k LEFT JOIN ciclos_cartao cc ON cc.cartao_id = k.id AND cc.competencia = k.ciclo_atual`),
      pool.query(`SELECT
                    COALESCE(SUM(valor) FILTER (WHERE tipo='pagamento_fiado' AND data_hora::date = $1),0) AS recebido_hoje,
                    COALESCE(SUM(valor) FILTER (WHERE tipo='pagamento_fiado' AND data_hora::date BETWEEN $2 AND $3),0) AS recebido_periodo,
                    COUNT(*) FILTER (WHERE tipo IN ('compra_fiado','compra_cartao') AND data_hora::date = $1) AS compras_hoje_qtd,
                    COALESCE(SUM(valor) FILTER (WHERE tipo IN ('compra_fiado','compra_cartao') AND data_hora::date = $1),0) AS compras_hoje_valor
                  FROM transacoes WHERE status = 'confirmada'`, [hoje, q.de, q.ate]),
      pool.query(`SELECT d::date AS dia,
                         COALESCE(SUM(t.valor) FILTER (WHERE t.tipo='compra_fiado'),0) AS fiado,
                         COALESCE(SUM(t.valor) FILTER (WHERE t.tipo='pagamento_fiado'),0) AS recebimentos,
                         COALESCE(SUM(t.valor) FILTER (WHERE t.tipo='compra_cartao'),0) AS cartao
                    FROM generate_series($1::date, $2::date, '1 day') d
                    LEFT JOIN transacoes t ON t.data_hora::date = d::date AND t.status = 'confirmada'
                   GROUP BY d ORDER BY d`, [q.de, q.ate]),
      pool.query(`SELECT c.id AS cliente_id, c.nome, c.telefone, l.vencimento, l.saldo_pendente
                    FROM lancamentos_fiado l JOIN contas_fiado cf ON cf.id = l.conta_id JOIN clientes c ON c.id = cf.cliente_id
                   WHERE l.status='aberto' AND l.vencimento BETWEEN $1 AND $2 ORDER BY l.vencimento LIMIT 50`,
        [hoje, somarDias(hoje, Number(await lerConfig('alerta_vencimento_dias')))]),
      pool.query(`SELECT c.id AS cliente_id, c.nome, cf.limite, cf.saldo_devedor,
                         ROUND(cf.saldo_devedor * 100 / NULLIF(cf.limite,0)) AS percentual
                    FROM contas_fiado cf JOIN clientes c ON c.id = cf.cliente_id
                   WHERE cf.limite > 0 AND cf.saldo_devedor * 100 >= cf.limite * $1
                   ORDER BY percentual DESC LIMIT 50`, [Number(await lerConfig('alerta_limite_percentual'))]),
    ]);
    return {
      periodo: q, gerado_em: new Date().toISOString(),
      clientes: clientes.rows[0], fiado: fiado.rows[0], cartoes: cartoes.rows[0], movimento: mov.rows[0],
      serie: serie.rows, alertas: { vencendo: alertasVenc.rows, limite: alertasLimite.rows },
    };
  });

  // ---------------- Usuários (seção 3) ----------------
  app.get('/usuarios', { preHandler: exigir('usuarios.gerenciar') }, async () =>
    (await pool.query(`SELECT u.id, u.nome, u.login, u.ativo, u.criado_em, u.ultimo_acesso, p.nome AS perfil
                         FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id <> $1 ORDER BY u.nome`, [USUARIO_SISTEMA_ID])).rows);

  app.get('/perfis', { preHandler: autenticar }, async () =>
    (await pool.query(`SELECT p.id, p.nome, array_agg(pe.codigo ORDER BY pe.codigo) AS permissoes FROM perfis p
                         JOIN perfis_permissoes pp ON pp.perfil_id = p.id JOIN permissoes pe ON pe.id = pp.permissao_id
                        GROUP BY p.id ORDER BY p.id`)).rows);

  const zPerfil = z.enum(['administrador', 'gerente', 'operador']);

  app.post('/usuarios', { preHandler: exigir('usuarios.gerenciar') }, async (req, rep) => {
    const b = validar(z.object({
      nome: z.string().trim().min(2), login: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, 'use letras, números, ponto ou traço (3 a 30)'),
      senha_temporaria: z.string().min(8, 'mínimo de 8 caracteres'), perfil: zPerfil,
    }), req.body);
    return tx(async (db) => {
      const ex = await db.query('SELECT 1 FROM usuarios WHERE login = $1', [b.login]);
      if (ex.rowCount) throw new ErroNegocio('LOGIN_DUPLICADO', 'Este login já está em uso', 409);
      const u = (await db.query(
        `INSERT INTO usuarios (nome, login, senha_hash, perfil_id, trocar_senha)
         SELECT $1,$2,$3,id,TRUE FROM perfis WHERE nome = $4 RETURNING id, nome, login, ativo`,
        [b.nome, b.login, await bcrypt.hash(b.senha_temporaria, 10), b.perfil])).rows[0];
      await auditar(db, req.ctx.usuarioId, 'criar_usuario', 'usuario', u.id, { login: b.login, perfil: b.perfil });
      rep.code(201);
      return u;
    });
  });

  app.put('/usuarios/:id', { preHandler: exigir('usuarios.gerenciar') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ nome: z.string().trim().min(2).optional(), perfil: zPerfil.optional(), ativo: z.boolean().optional() }), req.body);
    if (id === req.ctx.usuarioId && (b.ativo === false || (b.perfil && b.perfil !== 'administrador'))) {
      throw new ErroNegocio('OPERACAO_INVALIDA', 'Você não pode desativar ou rebaixar o próprio usuário');
    }
    if (id === USUARIO_SISTEMA_ID) throw naoEncontrado('Usuário');
    return tx(async (db) => {
      const antes = (await db.query(`SELECT u.*, p.nome AS perfil FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1 FOR UPDATE OF u`, [id])).rows[0];
      if (!antes) throw naoEncontrado('Usuário');
      await db.query(
        `UPDATE usuarios SET nome = $1, ativo = $2, perfil_id = (SELECT id FROM perfis WHERE nome = $3) WHERE id = $4`,
        [b.nome ?? antes.nome, b.ativo ?? antes.ativo, b.perfil ?? antes.perfil, id]);
      await auditar(db, req.ctx.usuarioId, 'editar_usuario', 'usuario', id,
        { de: { perfil: antes.perfil, ativo: antes.ativo }, para: { perfil: b.perfil ?? antes.perfil, ativo: b.ativo ?? antes.ativo } });
      return { id, ok: true };
    });
  });

  // Recuperação de acesso: o administrador define uma senha temporária; a atual nunca é revelada.
  app.post('/usuarios/:id/redefinir-senha', { preHandler: exigir('usuarios.gerenciar') }, async (req) => {
    const { id } = validar(z.object({ id: zUuid }), req.params);
    const b = validar(z.object({ senha_temporaria: z.string().min(8, 'mínimo de 8 caracteres') }), req.body);
    const r = await pool.query('UPDATE usuarios SET senha_hash = $1, trocar_senha = TRUE WHERE id = $2 AND id <> $3',
      [await bcrypt.hash(b.senha_temporaria, 10), id, USUARIO_SISTEMA_ID]);
    if (!r.rowCount) throw naoEncontrado('Usuário');
    await pool.query(`INSERT INTO auditoria_acoes (usuario_id, acao, entidade, entidade_id) VALUES ($1,'redefinir_senha','usuario',$2)`, [req.ctx.usuarioId, id]);
    return { ok: true };
  });

  // ---------------- Configurações ----------------
  app.get('/configuracoes', async () =>
    Object.fromEntries((await pool.query('SELECT chave, valor FROM configuracoes')).rows.map((r) => [r.chave, r.valor])));

  app.put('/configuracoes', { preHandler: exigir('configuracoes.gerenciar') }, async (req) => {
    const b = validar(z.object({
      prazo_vencimento_dias: z.number().int().min(1).max(365).optional(),
      limite_fiado_padrao: z.number().min(0).max(1_000_000).optional(),
      alerta_limite_percentual: z.number().int().min(1).max(100).optional(),
      alerta_vencimento_dias: z.number().int().min(0).max(60).optional(),
      sessao_minutos: z.number().int().min(5).max(720).optional(),
    }), req.body);
    return tx(async (db) => {
      for (const [k, v] of Object.entries(b)) {
        if (v === undefined) continue;
        const antes = (await db.query('SELECT valor FROM configuracoes WHERE chave = $1', [k])).rows[0]?.valor;
        await db.query(`UPDATE configuracoes SET valor = $1, atualizado_por = $2, atualizado_em = now() WHERE chave = $3`, [String(v), req.ctx.usuarioId, k]);
        await auditar(db, req.ctx.usuarioId, 'alterar_configuracao', 'configuracao', k, { de: antes, para: String(v) });
      }
      return Object.fromEntries((await db.query('SELECT chave, valor FROM configuracoes')).rows.map((r) => [r.chave, r.valor]));
    });
  });

  // ---------------- Auditoria ----------------
  app.get('/auditoria', { preHandler: exigir('auditoria.ver') }, async (req) => {
    const q = validar(z.object({ entidade: z.string().optional(), entidade_id: z.string().optional(), limite: z.coerce.number().int().min(1).max(1000).default(200) }), req.query);
    const params: unknown[] = [];
    const cond: string[] = [];
    if (q.entidade) { params.push(q.entidade); cond.push(`a.entidade = $${params.length}`); }
    if (q.entidade_id) { params.push(q.entidade_id); cond.push(`a.entidade_id = $${params.length}`); }
    params.push(q.limite);
    return (await pool.query(
      `SELECT a.*, u.nome AS usuario_nome FROM auditoria_acoes a LEFT JOIN usuarios u ON u.id = a.usuario_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.data_hora DESC LIMIT $${params.length}`, params)).rows;
  });
}
