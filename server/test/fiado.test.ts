import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { bancoLimpo, ctxDe, novoCliente, saldoConta, uuid, pool } from './helpers.js';
import { registrarCompraFiado, registrarPagamento } from '../src/modules/fiado.service.js';
import { estornar } from '../src/modules/estornos.service.js';
import type { Contexto } from '../src/lib/contexto.js';

let op: Contexto, ger: Contexto;
beforeAll(async () => { await bancoLimpo(); op = await ctxDe('operador'); ger = await ctxDe('gerente'); });
afterAll(async () => { await pool.end(); });

describe('compra fiada', () => {
  it('registra compra, lançamento e atualiza saldo', async () => {
    const c = await novoCliente(100);
    const r = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 30.1, descricao: 'pão e leite' });
    expect(r.repetida).toBe(false);
    expect(r.transacao.usuario_id).toBe(op.usuarioId);
    expect(await saldoConta(c.id)).toBe('30.10');
  });

  it('reenvio com o mesmo UUID não duplica (RN-12)', async () => {
    const c = await novoCliente(100);
    const id = uuid();
    await registrarCompraFiado(op, { uuid_operacao: id, cliente_id: c.id, valor: 10 });
    const r2 = await registrarCompraFiado(op, { uuid_operacao: id, cliente_id: c.id, valor: 10 });
    expect(r2.repetida).toBe(true);
    expect(await saldoConta(c.id)).toBe('10.00');
  });

  it('bloqueia compra acima do limite (RN-03)', async () => {
    const c = await novoCliente(50);
    await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 40 });
    await expect(registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 10.01 }))
      .rejects.toMatchObject({ codigo: 'LIMITE_EXCEDIDO' });
    expect(await saldoConta(c.id)).toBe('40.00');
  });

  it('operador não pode exceder limite; gerente pode com justificativa (RN-14)', async () => {
    const c = await novoCliente(10);
    await expect(registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 20, excecao_limite: true, justificativa: 'x' }))
      .rejects.toMatchObject({ codigo: 'SEM_PERMISSAO' });
    await expect(registrarCompraFiado(ger, { uuid_operacao: uuid(), cliente_id: c.id, valor: 20, excecao_limite: true }))
      .rejects.toMatchObject({ codigo: 'JUSTIFICATIVA_OBRIGATORIA' });
    const r = await registrarCompraFiado(ger, { uuid_operacao: uuid(), cliente_id: c.id, valor: 20, excecao_limite: true, justificativa: 'cliente antigo' });
    expect(r.transacao.excecao_limite).toBe(true);
    expect(await saldoConta(c.id)).toBe('20.00');
  });

  it('cliente bloqueado ou crédito bloqueado não compra', async () => {
    const c = await novoCliente(100, { status: 'bloqueado' });
    await expect(registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 1 }))
      .rejects.toMatchObject({ codigo: 'CLIENTE_NAO_ATIVO' });
    const c2 = await novoCliente(100);
    await pool.query(`UPDATE contas_fiado SET status='bloqueada' WHERE cliente_id=$1`, [c2.id]);
    await expect(registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c2.id, valor: 1 }))
      .rejects.toMatchObject({ codigo: 'CREDITO_BLOQUEADO' });
  });

  it('vencimento padrão usa o prazo configurado', async () => {
    const c = await novoCliente(100);
    const r = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 5 });
    const d = new Date(); d.setDate(d.getDate() + 30);
    const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(r.dados!.lancamento.vencimento).toBe(esperado);
  });

  it('concorrência: dois dispositivos não estouram o limite juntos', async () => {
    const c = await novoCliente(100);
    const rs = await Promise.allSettled([
      registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 60 }),
      registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 60 }),
    ]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await saldoConta(c.id)).toBe('60.00');
  });

  it('mesmo UUID enviado em paralelo grava uma vez só', async () => {
    const c = await novoCliente(100);
    const id = uuid();
    const rs = await Promise.all([1, 2, 3].map(() => registrarCompraFiado(op, { uuid_operacao: id, cliente_id: c.id, valor: 7 })));
    expect(rs.filter((r) => !r.repetida)).toHaveLength(1);
    expect(await saldoConta(c.id)).toBe('7.00');
  });
});

describe('pagamentos', () => {
  it('pagamento parcial abate do débito mais antigo e mantém aberto (RN-05)', async () => {
    const c = await novoCliente(500);
    const a = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 50, vencimento: '2026-01-10' });
    const b = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 30, vencimento: '2026-02-10' });
    const p = await registrarPagamento(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 60, meio_pagamento: 'pix' });
    expect(p.dados!.alocacoes).toEqual([
      { lancamento_id: a.dados!.lancamento.id, valor: '50.00', quitado: true },
      { lancamento_id: b.dados!.lancamento.id, valor: '10.00', quitado: false },
    ]);
    expect(await saldoConta(c.id)).toBe('20.00');
  });

  it('pagamento nos débitos escolhidos', async () => {
    const c = await novoCliente(500);
    await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 50, vencimento: '2026-01-10' });
    const b = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 30, vencimento: '2026-02-10' });
    const p = await registrarPagamento(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 30, meio_pagamento: 'dinheiro', lancamento_ids: [b.dados!.lancamento.id] });
    expect(p.dados!.alocacoes).toHaveLength(1);
    expect(p.dados!.alocacoes[0].quitado).toBe(true);
    await expect(registrarPagamento(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 1, meio_pagamento: 'dinheiro', lancamento_ids: [b.dados!.lancamento.id] }))
      .rejects.toMatchObject({ codigo: 'PAGAMENTO_EXCEDENTE' });
  });

  it('recusa pagamento acima do saldo (RN-04)', async () => {
    const c = await novoCliente(500);
    await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 10 });
    await expect(registrarPagamento(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 10.01, meio_pagamento: 'pix' }))
      .rejects.toMatchObject({ codigo: 'PAGAMENTO_EXCEDENTE' });
  });
});

describe('estornos de fiado', () => {
  it('operador não estorna; gerente estorna compra sem apagar a original (RN-10)', async () => {
    const c = await novoCliente(500);
    const compra = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 25 });
    await expect(estornar(op, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'erro' })).rejects.toMatchObject({ codigo: 'SEM_PERMISSAO' });
    const e = await estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'lançado errado' });
    expect(e.transacao.tipo).toBe('estorno');
    expect(e.transacao.referencia_transacao_id).toBe(compra.transacao.id);
    const orig = (await pool.query('SELECT status, valor FROM transacoes WHERE id = $1', [compra.transacao.id])).rows[0];
    expect(orig).toEqual({ status: 'estornada', valor: '25.00' });
    expect(await saldoConta(c.id)).toBe('0.00');
    await expect(estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'de novo' })).rejects.toMatchObject({ codigo: 'JA_ESTORNADA' });
  });

  it('compra com pagamento exige estornar o pagamento antes', async () => {
    const c = await novoCliente(500);
    const compra = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 40 });
    const pag = await registrarPagamento(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 15, meio_pagamento: 'pix' });
    await expect(estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'x' })).rejects.toMatchObject({ codigo: 'COMPRA_COM_PAGAMENTOS' });
    await estornar(ger, pag.transacao.id, { uuid_operacao: uuid(), motivo: 'pix não caiu' });
    expect(await saldoConta(c.id)).toBe('40.00');
    const l = (await pool.query('SELECT saldo_pendente, status FROM lancamentos_fiado WHERE transacao_id = $1', [compra.transacao.id])).rows[0];
    expect(l).toEqual({ saldo_pendente: '40.00', status: 'aberto' });
    await estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'desistiu' });
    expect(await saldoConta(c.id)).toBe('0.00');
  });

  it('banco impede editar ou excluir transação (RN-11)', async () => {
    const c = await novoCliente(500);
    const compra = await registrarCompraFiado(op, { uuid_operacao: uuid(), cliente_id: c.id, valor: 5 });
    await expect(pool.query('UPDATE transacoes SET valor = 1 WHERE id = $1', [compra.transacao.id])).rejects.toThrow(/RN-11/);
    await expect(pool.query('DELETE FROM transacoes WHERE id = $1', [compra.transacao.id])).rejects.toThrow(/RN-11/);
  });
});
