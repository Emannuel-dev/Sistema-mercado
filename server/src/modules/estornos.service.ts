import { ErroNegocio, naoEncontrado, semPermissao } from '../lib/erros.js';
import { paraCentavos, paraReais } from '../lib/dinheiro.js';
import { pode, type Contexto } from '../lib/contexto.js';
import { inserirTransacao } from '../lib/transacoes.js';
import { executarIdempotente } from '../lib/idempotencia.js';
import { travarConta } from './fiado.service.js';
import { cartaoVigente } from './cartoes.service.js';

/**
 * Fluxo 8.5 — estorno (RF-FIA-10, RF-CAR-09; RN-10).
 * Nunca apaga a transação original: cria uma transação compensatória vinculada
 * e marca a original como 'estornada'. Sempre pelo valor total.
 */
export async function estornar(ctx: Contexto, transacaoId: string, input: { uuid_operacao: string; motivo: string }) {
  if (!pode(ctx, 'transacoes.estornar')) throw semPermissao();
  if (!input.motivo?.trim()) throw new ErroNegocio('JUSTIFICATIVA_OBRIGATORIA', 'Informe o motivo do estorno');

  return executarIdempotente(input.uuid_operacao, async (db) => {
    const r = await db.query('SELECT * FROM transacoes WHERE id = $1 FOR UPDATE', [transacaoId]);
    if (!r.rowCount) throw naoEncontrado('Transação');
    const orig = r.rows[0];
    if (orig.status !== 'confirmada') throw new ErroNegocio('JA_ESTORNADA', 'Esta transação já foi estornada', 409);
    if (!['compra_fiado', 'pagamento_fiado', 'compra_cartao'].includes(orig.tipo)) {
      throw new ErroNegocio('NAO_ESTORNAVEL', 'Este tipo de transação não pode ser estornado');
    }
    const valorC = paraCentavos(orig.valor);
    let cartaoId: string | null = null;

    if (orig.tipo === 'compra_fiado') {
      const conta = await travarConta(db, orig.cliente_id);
      const l = (await db.query('SELECT * FROM lancamentos_fiado WHERE transacao_id = $1 FOR UPDATE', [orig.id])).rows[0];
      if (paraCentavos(l.saldo_pendente) !== paraCentavos(l.valor_original)) {
        throw new ErroNegocio('COMPRA_COM_PAGAMENTOS',
          'Esta compra já recebeu pagamentos. Estorne os pagamentos antes de estornar a compra.');
      }
      await db.query(`UPDATE lancamentos_fiado SET saldo_pendente = 0, status = 'estornado' WHERE id = $1`, [l.id]);
      await db.query('UPDATE contas_fiado SET saldo_devedor = $1 WHERE id = $2',
        [paraReais(paraCentavos(conta.saldo_devedor) - valorC), conta.id]);
    } else if (orig.tipo === 'pagamento_fiado') {
      const conta = await travarConta(db, orig.cliente_id);
      const alocs = (await db.query(
        `SELECT a.lancamento_id, a.valor FROM pagamentos_alocacoes a JOIN pagamentos p ON p.id = a.pagamento_id
          WHERE p.transacao_id = $1`, [orig.id])).rows;
      for (const a of alocs) {
        await db.query(
          `UPDATE lancamentos_fiado SET saldo_pendente = saldo_pendente + $1, status = 'aberto' WHERE id = $2`,
          [a.valor, a.lancamento_id],
        );
      }
      await db.query('UPDATE contas_fiado SET saldo_devedor = $1 WHERE id = $2',
        [paraReais(paraCentavos(conta.saldo_devedor) + valorC), conta.id]);
    } else {
      cartaoId = await cartaoVigente(db, orig.cartao_id);
      const k = (await db.query('SELECT * FROM cartoes_cliente WHERE id = $1 FOR UPDATE', [cartaoId])).rows[0];
      if (k.ciclo_atual !== orig.competencia) {
        throw new ErroNegocio('CICLO_ENCERRADO',
          'A compra pertence a um ciclo já encerrado; o estorno no cartão não é possível.');
      }
      await db.query('UPDATE cartoes_cliente SET saldo = saldo + $1 WHERE id = $2', [orig.valor, cartaoId]);
      await db.query(
        `UPDATE ciclos_cartao SET valor_utilizado = valor_utilizado - $1 WHERE cartao_id = $2 AND competencia = $3`,
        [orig.valor, cartaoId, orig.competencia],
      );
    }

    const transacao = await inserirTransacao(db, ctx, {
      uuidOperacao: input.uuid_operacao,
      clienteId: orig.cliente_id,
      cartaoId: cartaoId ?? orig.cartao_id,
      tipo: 'estorno',
      valor: orig.valor,
      descricao: `Estorno de ${orig.tipo.replace('_', ' ')}`,
      referenciaId: orig.id,
      justificativa: input.motivo,
      competencia: orig.competencia,
    });
    await db.query(`UPDATE transacoes SET status = 'estornada' WHERE id = $1`, [orig.id]);
    return { transacao, dados: { original_id: orig.id } };
  });
}
