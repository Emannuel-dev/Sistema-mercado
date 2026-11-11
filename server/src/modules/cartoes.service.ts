import { randomUUID } from 'node:crypto';
import { tx, query, type Db } from '../db/pool.js';
import { ErroNegocio, naoEncontrado, semPermissao } from '../lib/erros.js';
import { paraCentavos, paraReais } from '../lib/dinheiro.js';
import { competenciaVigente } from '../lib/datas.js';
import { pode, type Contexto } from '../lib/contexto.js';
import { inserirTransacao } from '../lib/transacoes.js';
import { executarIdempotente } from '../lib/idempotencia.js';
import { auditar } from '../lib/auditoria.js';
import { USUARIO_SISTEMA_ID } from '../config.js';

const exigir = (ctx: Contexto, p: string) => { if (!pode(ctx, p)) throw semPermissao(); };

export interface NovoCartaoInput {
  cliente_id: string;
  identificador: string;
  limite_recorrente: number;
  dia_virada: number;
}

function validarDia(dia: number) {
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) {
    throw new ErroNegocio('DIA_VIRADA_INVALIDO', 'O dia de virada deve estar entre 1 e 28');
  }
}

async function travarCartao(db: Db, where: string, valor: string) {
  const r = await db.query(
    `SELECT k.*, c.status AS cliente_status FROM cartoes_cliente k JOIN clientes c ON c.id = k.cliente_id
      WHERE ${where} = $1 FOR UPDATE OF k`,
    [valor],
  );
  if (!r.rowCount) throw naoEncontrado('Cartão');
  return r.rows[0];
}

/** Registra a liberação de um ciclo. A restrição única (cartao, competência) garante idempotência (RN-09). */
async function liberarCiclo(db: Db, ctx: Contexto, cartao: any, competencia: string, limite: string, origemAuditoria: string) {
  const ins = await db.query(
    `INSERT INTO ciclos_cartao (cartao_id, competencia, limite_liberado) VALUES ($1,$2,$3)
     ON CONFLICT (cartao_id, competencia) DO NOTHING RETURNING id`,
    [cartao.id, competencia, limite],
  );
  if (!ins.rowCount) return false;
  let transacaoId: string | null = null;
  if (paraCentavos(limite) > 0) {
    const t = await inserirTransacao(db, ctx, {
      uuidOperacao: randomUUID(),
      clienteId: cartao.cliente_id,
      cartaoId: cartao.id,
      tipo: 'virada_cartao',
      valor: limite,
      descricao: `Liberação do ciclo ${competencia}`,
      competencia,
    });
    transacaoId = t.id;
  }
  await db.query('UPDATE ciclos_cartao SET transacao_id = $1 WHERE id = $2', [transacaoId, ins.rows[0].id]);
  // Política adotada: o saldo remanescente é substituído pelo novo limite (não acumula).
  await db.query('UPDATE cartoes_cliente SET saldo = $1, ciclo_atual = $2 WHERE id = $3', [limite, competencia, cartao.id]);
  await auditar(db, ctx.usuarioId, 'virada_cartao', 'cartao', cartao.id,
    { competencia, limite_liberado: limite, saldo_anterior: cartao.saldo, origem: origemAuditoria });
  cartao.saldo = limite;
  cartao.ciclo_atual = competencia;
  return true;
}

/** Aplica a virada se o ciclo vigente for posterior ao ciclo atual do cartão. */
async function aplicarViradaSeDevida(db: Db, ctx: Contexto, cartao: any, agora: Date, origem: string) {
  if (cartao.status === 'cancelado' || cartao.status === 'inativo') return false;
  const comp = competenciaVigente(agora, cartao.dia_virada);
  if (comp <= cartao.ciclo_atual) return false;
  return liberarCiclo(db, ctx, cartao, comp, cartao.limite_recorrente, origem);
}

/** RF-CAR-01 — cadastro de cartão. O primeiro ciclo é liberado na criação. */
export async function criarCartao(ctx: Contexto, input: NovoCartaoInput) {
  exigir(ctx, 'cartoes.gerenciar');
  validarDia(input.dia_virada);
  const identificador = input.identificador.trim();
  if (!identificador) throw new ErroNegocio('IDENTIFICADOR_INVALIDO', 'Informe o identificador do cartão');
  if (paraCentavos(input.limite_recorrente) < 0) throw new ErroNegocio('VALOR_INVALIDO', 'Limite inválido');

  return tx(async (db) => {
    const cli = await db.query('SELECT status FROM clientes WHERE id = $1', [input.cliente_id]);
    if (!cli.rowCount) throw naoEncontrado('Cliente');
    const dup = await db.query('SELECT 1 FROM cartoes_cliente WHERE identificador = $1', [identificador]);
    if (dup.rowCount) throw new ErroNegocio('IDENTIFICADOR_DUPLICADO', 'Já existe um cartão com este identificador', 409);

    const comp = competenciaVigente(new Date(), input.dia_virada);
    const limite = paraReais(paraCentavos(input.limite_recorrente));
    const cartao = (await db.query(
      `INSERT INTO cartoes_cliente (cliente_id, identificador, limite_recorrente, dia_virada, saldo, ciclo_atual)
       VALUES ($1,$2,$3,$4,0,'0000-00') RETURNING *`,
      [input.cliente_id, identificador, limite, input.dia_virada],
    )).rows[0];
    await liberarCiclo(db, ctx, cartao, comp, limite, 'cadastro');
    await auditar(db, ctx.usuarioId, 'criar_cartao', 'cartao', cartao.id, { identificador, limite, dia_virada: input.dia_virada });
    return cartao;
  });
}

/** Fluxo 8.3 — compra no cartão (RF-CAR-03; RN-07, RN-08). */
export async function compraCartao(ctx: Contexto, input: { uuid_operacao: string; identificador: string; valor: number; descricao?: string | null }) {
  exigir(ctx, 'cartoes.comprar');
  const valorC = paraCentavos(input.valor);
  if (valorC <= 0) throw new ErroNegocio('VALOR_INVALIDO', 'O valor deve ser maior que zero');

  return executarIdempotente(input.uuid_operacao, async (db) => {
    const cartao = await travarCartao(db, 'k.identificador', input.identificador.trim());
    if (cartao.status !== 'ativo') {
      throw new ErroNegocio('CARTAO_NAO_ATIVO', `Cartão ${cartao.status}; compra não autorizada`);
    }
    if (cartao.cliente_status !== 'ativo') {
      throw new ErroNegocio('CLIENTE_NAO_ATIVO', `Cliente está ${cartao.cliente_status}; compra não autorizada`);
    }
    await aplicarViradaSeDevida(db, sistema(), cartao, new Date(), 'compra');

    const saldoC = paraCentavos(cartao.saldo);
    if (valorC > saldoC) {
      throw new ErroNegocio('SALDO_INSUFICIENTE', `Saldo insuficiente: disponível R$ ${paraReais(saldoC)}`, 422,
        { disponivel: paraReais(saldoC) });
    }
    const transacao = await inserirTransacao(db, ctx, {
      uuidOperacao: input.uuid_operacao,
      clienteId: cartao.cliente_id,
      cartaoId: cartao.id,
      tipo: 'compra_cartao',
      valor: paraReais(valorC),
      descricao: input.descricao,
      competencia: cartao.ciclo_atual,
    });
    const novo = paraReais(saldoC - valorC);
    await db.query('UPDATE cartoes_cliente SET saldo = $1 WHERE id = $2', [novo, cartao.id]);
    await db.query(
      'UPDATE ciclos_cartao SET valor_utilizado = valor_utilizado + $1 WHERE cartao_id = $2 AND competencia = $3',
      [paraReais(valorC), cartao.id, cartao.ciclo_atual],
    );
    return { transacao, dados: { saldo_disponivel: novo, cartao_id: cartao.id } };
  });
}

export function sistema(): Contexto {
  return { usuarioId: USUARIO_SISTEMA_ID, permissoes: new Set(), origem: 'sistema' };
}

/** RF-CAR-06 — virada de um cartão (manual). Idempotente por cartão e ciclo. */
export async function viradaCartao(ctx: Contexto, cartaoId: string, agora = new Date()) {
  exigir(ctx, 'cartoes.virada');
  return tx(async (db) => {
    const cartao = await travarCartao(db, 'k.id', cartaoId);
    const feita = await aplicarViradaSeDevida(db, ctx, cartao, agora, 'manual');
    return { processada: feita, ciclo_atual: cartao.ciclo_atual, saldo: cartao.saldo };
  });
}

/** Rotina automática: processa todos os cartões cuja data de virada chegou. Falhas são registradas e não param a rotina. */
export async function processarViradas(agora = new Date()) {
  const ids = (await query(`SELECT id FROM cartoes_cliente WHERE status IN ('ativo','bloqueado')`)).rows.map((r) => r.id);
  const resultado = { processadas: 0, falhas: [] as { cartao_id: string; erro: string }[] };
  for (const id of ids) {
    try {
      const ok = await tx(async (db) => {
        const cartao = await travarCartao(db, 'k.id', id);
        return aplicarViradaSeDevida(db, sistema(), cartao, agora, 'automatica');
      });
      if (ok) resultado.processadas++;
    } catch (e: any) {
      resultado.falhas.push({ cartao_id: id, erro: e.message });
      await query(`INSERT INTO auditoria_acoes (usuario_id, acao, entidade, entidade_id, detalhes) VALUES ($1,'falha_virada','cartao',$2,$3)`,
        [USUARIO_SISTEMA_ID, id, JSON.stringify({ erro: e.message })]).catch(() => {});
    }
  }
  return resultado;
}

/** RF-CAR-04 — bloquear, desbloquear ou cancelar. */
export async function alterarStatusCartao(ctx: Contexto, cartaoId: string, acao: 'bloquear' | 'desbloquear' | 'cancelar', motivo?: string) {
  exigir(ctx, 'cartoes.gerenciar');
  return tx(async (db) => {
    const cartao = await travarCartao(db, 'k.id', cartaoId);
    if (cartao.status === 'cancelado' || cartao.status === 'inativo') {
      throw new ErroNegocio('CARTAO_ENCERRADO', `Cartão ${cartao.status} não pode ser alterado`);
    }
    const novo = { bloquear: 'bloqueado', desbloquear: 'ativo', cancelar: 'cancelado' }[acao];
    if (acao === 'cancelar' && !motivo?.trim()) throw new ErroNegocio('JUSTIFICATIVA_OBRIGATORIA', 'Informe o motivo do cancelamento');
    await db.query('UPDATE cartoes_cliente SET status = $1 WHERE id = $2', [novo, cartaoId]);
    await auditar(db, ctx.usuarioId, `${acao}_cartao`, 'cartao', cartaoId, { de: cartao.status, para: novo, motivo });
    return { ...cartao, status: novo };
  });
}

/** RF-CAR-07 — altera limite recorrente e dia de virada. Novo limite vale a partir da próxima virada. */
export async function alterarParametrosCartao(ctx: Contexto, cartaoId: string, input: { limite_recorrente?: number; dia_virada?: number }) {
  exigir(ctx, 'cartoes.gerenciar');
  if (input.dia_virada !== undefined) validarDia(input.dia_virada);
  return tx(async (db) => {
    const cartao = await travarCartao(db, 'k.id', cartaoId);
    const limite = input.limite_recorrente !== undefined ? paraReais(paraCentavos(input.limite_recorrente)) : cartao.limite_recorrente;
    const dia = input.dia_virada ?? cartao.dia_virada;
    await db.query('UPDATE cartoes_cliente SET limite_recorrente = $1, dia_virada = $2 WHERE id = $3', [limite, dia, cartaoId]);
    await auditar(db, ctx.usuarioId, 'alterar_parametros_cartao', 'cartao', cartaoId,
      { limite_anterior: cartao.limite_recorrente, limite_novo: limite, dia_anterior: cartao.dia_virada, dia_novo: dia });
    return { ...cartao, limite_recorrente: limite, dia_virada: dia };
  });
}

/** RF-CAR-05 — segunda via: novo identificador herda saldo e ciclo; o anterior é inativado na hora. */
export async function segundaVia(ctx: Contexto, cartaoId: string, input: { novo_identificador: string; motivo: string }) {
  exigir(ctx, 'cartoes.gerenciar');
  const ident = input.novo_identificador.trim();
  if (!ident) throw new ErroNegocio('IDENTIFICADOR_INVALIDO', 'Informe o novo identificador');
  if (!input.motivo?.trim()) throw new ErroNegocio('JUSTIFICATIVA_OBRIGATORIA', 'Informe o motivo da segunda via');
  return tx(async (db) => {
    const antigo = await travarCartao(db, 'k.id', cartaoId);
    if (antigo.status === 'cancelado' || antigo.status === 'inativo') {
      throw new ErroNegocio('CARTAO_ENCERRADO', `Cartão ${antigo.status} não admite segunda via`);
    }
    const dup = await db.query('SELECT 1 FROM cartoes_cliente WHERE identificador = $1', [ident]);
    if (dup.rowCount) throw new ErroNegocio('IDENTIFICADOR_DUPLICADO', 'Já existe um cartão com este identificador', 409);

    await db.query(`UPDATE cartoes_cliente SET status = 'inativo', saldo = 0 WHERE id = $1`, [cartaoId]);
    const novo = (await db.query(
      `INSERT INTO cartoes_cliente (cliente_id, identificador, limite_recorrente, dia_virada, saldo, status, ciclo_atual, substitui_cartao_id)
       VALUES ($1,$2,$3,$4,$5,'ativo',$6,$7) RETURNING *`,
      [antigo.cliente_id, ident, antigo.limite_recorrente, antigo.dia_virada, antigo.saldo, antigo.ciclo_atual, cartaoId],
    )).rows[0];
    // O ciclo vigente passa para o novo cartão, preservando o valor já utilizado.
    await db.query(
      `INSERT INTO ciclos_cartao (cartao_id, competencia, limite_liberado, valor_utilizado, transacao_id)
       SELECT $1, competencia, limite_liberado, valor_utilizado, transacao_id FROM ciclos_cartao
        WHERE cartao_id = $2 AND competencia = $3`,
      [novo.id, cartaoId, antigo.ciclo_atual],
    );
    await auditar(db, ctx.usuarioId, 'segunda_via_cartao', 'cartao', novo.id,
      { cartao_anterior: cartaoId, identificador_anterior: antigo.identificador, motivo: input.motivo });
    return novo;
  });
}

/** Segue a cadeia de segundas vias até o cartão vigente. */
export async function cartaoVigente(db: Db, cartaoId: string) {
  let atual = cartaoId;
  for (let i = 0; i < 50; i++) {
    const r = await db.query('SELECT id FROM cartoes_cliente WHERE substitui_cartao_id = $1', [atual]);
    if (!r.rowCount) return atual;
    atual = r.rows[0].id;
  }
  return atual;
}
