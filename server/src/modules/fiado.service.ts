import type { Db } from '../db/pool.js';
import { ErroNegocio, naoEncontrado, semPermissao } from '../lib/erros.js';
import { paraCentavos, paraReais } from '../lib/dinheiro.js';
import { hojeISO, somarDias } from '../lib/datas.js';
import { pode, type Contexto } from '../lib/contexto.js';
import { inserirTransacao } from '../lib/transacoes.js';
import { executarIdempotente } from '../lib/idempotencia.js';
import { lerConfig } from '../lib/configuracoes.js';

export interface CompraFiadoInput {
  uuid_operacao: string;
  cliente_id: string;
  valor: number;
  descricao?: string | null;
  vencimento?: string | null;
  excecao_limite?: boolean;
  justificativa?: string | null;
}

export interface PagamentoInput {
  uuid_operacao: string;
  cliente_id: string;
  valor: number;
  meio_pagamento: 'dinheiro' | 'pix' | 'debito' | 'credito' | 'outro';
  observacao?: string | null;
  lancamento_ids?: string[];
}

/** Trava e devolve a conta de fiado do cliente junto com o status do cliente. */
export async function travarConta(db: Db, clienteId: string) {
  const r = await db.query(
    `SELECT cf.*, c.status AS cliente_status, c.nome AS cliente_nome
       FROM contas_fiado cf JOIN clientes c ON c.id = cf.cliente_id
      WHERE cf.cliente_id = $1
      FOR UPDATE OF cf`,
    [clienteId],
  );
  if (!r.rowCount) throw naoEncontrado('Cliente');
  return r.rows[0];
}

/** Fluxo 8.1 — compra fiada (RF-FIA-01, 02, 07; RN-03, RN-14). */
export async function registrarCompraFiado(ctx: Contexto, input: CompraFiadoInput) {
  if (!pode(ctx, 'fiado.lancar')) throw semPermissao();
  const valorC = paraCentavos(input.valor);
  if (valorC <= 0) throw new ErroNegocio('VALOR_INVALIDO', 'O valor deve ser maior que zero');

  return executarIdempotente(input.uuid_operacao, async (db) => {
    const conta = await travarConta(db, input.cliente_id);
    if (conta.cliente_status !== 'ativo') {
      throw new ErroNegocio('CLIENTE_NAO_ATIVO', `Cliente está ${conta.cliente_status}; compra não permitida`);
    }
    if (conta.status === 'bloqueada') {
      throw new ErroNegocio('CREDITO_BLOQUEADO', 'O crédito de fiado deste cliente está bloqueado');
    }

    const saldoC = paraCentavos(conta.saldo_devedor);
    const limiteC = paraCentavos(conta.limite);
    const novoSaldoC = saldoC + valorC;
    let excecao = false;
    if (novoSaldoC > limiteC) {
      if (!input.excecao_limite) {
        throw new ErroNegocio('LIMITE_EXCEDIDO',
          `Limite insuficiente: disponível R$ ${paraReais(Math.max(limiteC - saldoC, 0))}`, 422,
          { disponivel: paraReais(Math.max(limiteC - saldoC, 0)) });
      }
      if (!pode(ctx, 'fiado.exceder_limite')) {
        throw new ErroNegocio('SEM_PERMISSAO', 'Somente gerente ou administrador pode autorizar compra acima do limite', 403);
      }
      if (!input.justificativa?.trim()) {
        throw new ErroNegocio('JUSTIFICATIVA_OBRIGATORIA', 'Informe a justificativa para exceder o limite');
      }
      excecao = true;
    }

    let vencimento = input.vencimento;
    const hoje = hojeISO(ctx.dataHora ?? new Date());
    if (!vencimento) {
      vencimento = somarDias(hoje, Number(await lerConfig('prazo_vencimento_dias', db)));
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      throw new ErroNegocio('VENCIMENTO_INVALIDO', 'Vencimento inválido');
    }

    const transacao = await inserirTransacao(db, ctx, {
      uuidOperacao: input.uuid_operacao,
      clienteId: input.cliente_id,
      tipo: 'compra_fiado',
      valor: paraReais(valorC),
      descricao: input.descricao,
      justificativa: excecao ? input.justificativa : null,
      excecaoLimite: excecao,
    });
    const lanc = await db.query(
      `INSERT INTO lancamentos_fiado (conta_id, transacao_id, valor_original, saldo_pendente, vencimento)
       VALUES ($1,$2,$3,$3,$4) RETURNING *`,
      [conta.id, transacao.id, paraReais(valorC), vencimento],
    );
    await db.query('UPDATE contas_fiado SET saldo_devedor = $1 WHERE id = $2', [paraReais(novoSaldoC), conta.id]);

    return { transacao, dados: { lancamento: lanc.rows[0], saldo_devedor: paraReais(novoSaldoC) } };
  });
}

/** Fluxo 8.2 — pagamento parcial ou total (RF-FIA-03, 04; RN-04, RN-05). */
export async function registrarPagamento(ctx: Contexto, input: PagamentoInput) {
  if (!pode(ctx, 'fiado.pagamento')) throw semPermissao();
  const valorC = paraCentavos(input.valor);
  if (valorC <= 0) throw new ErroNegocio('VALOR_INVALIDO', 'O valor deve ser maior que zero');

  return executarIdempotente(input.uuid_operacao, async (db) => {
    const conta = await travarConta(db, input.cliente_id);
    const saldoC = paraCentavos(conta.saldo_devedor);
    if (valorC > saldoC) {
      throw new ErroNegocio('PAGAMENTO_EXCEDENTE',
        `Valor acima do saldo devido (R$ ${paraReais(saldoC)})`, 422, { saldo_devedor: paraReais(saldoC) });
    }

    // Débitos a quitar: os escolhidos pelo operador, ou os mais antigos primeiro.
    const params: unknown[] = [conta.id];
    let filtro = '';
    if (input.lancamento_ids?.length) {
      params.push(input.lancamento_ids);
      filtro = 'AND l.id = ANY($2::uuid[])';
    }
    const lancs = (await db.query(
      `SELECT l.* FROM lancamentos_fiado l JOIN transacoes t ON t.id = l.transacao_id
        WHERE l.conta_id = $1 AND l.status = 'aberto' ${filtro}
        ORDER BY l.vencimento, t.data_hora
        FOR UPDATE OF l`,
      params,
    )).rows;
    const disponivelC = lancs.reduce((s, l) => s + paraCentavos(l.saldo_pendente), 0);
    if (valorC > disponivelC) {
      throw new ErroNegocio('PAGAMENTO_EXCEDENTE',
        `Valor acima do saldo dos débitos selecionados (R$ ${paraReais(disponivelC)})`);
    }

    const transacao = await inserirTransacao(db, ctx, {
      uuidOperacao: input.uuid_operacao,
      clienteId: input.cliente_id,
      tipo: 'pagamento_fiado',
      valor: paraReais(valorC),
      descricao: input.observacao,
    });
    const pag = (await db.query(
      `INSERT INTO pagamentos (transacao_id, meio_pagamento, valor_recebido, observacao) VALUES ($1,$2,$3,$4) RETURNING *`,
      [transacao.id, input.meio_pagamento, paraReais(valorC), input.observacao ?? null],
    )).rows[0];

    let restante = valorC;
    const alocacoes: { lancamento_id: string; valor: string; quitado: boolean }[] = [];
    for (const l of lancs) {
      if (restante <= 0) break;
      const pendC = paraCentavos(l.saldo_pendente);
      const usar = Math.min(pendC, restante);
      restante -= usar;
      const novoPend = pendC - usar;
      await db.query(
        `UPDATE lancamentos_fiado SET saldo_pendente = $1, status = $2 WHERE id = $3`,
        [paraReais(novoPend), novoPend === 0 ? 'quitado' : 'aberto', l.id],
      );
      await db.query(
        `INSERT INTO pagamentos_alocacoes (pagamento_id, lancamento_id, valor) VALUES ($1,$2,$3)`,
        [pag.id, l.id, paraReais(usar)],
      );
      alocacoes.push({ lancamento_id: l.id, valor: paraReais(usar), quitado: novoPend === 0 });
    }
    const novoSaldo = saldoC - valorC;
    await db.query('UPDATE contas_fiado SET saldo_devedor = $1 WHERE id = $2', [paraReais(novoSaldo), conta.id]);

    return { transacao, dados: { pagamento: pag, alocacoes, saldo_devedor: paraReais(novoSaldo) } };
  });
}
