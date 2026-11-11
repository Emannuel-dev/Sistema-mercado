import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { bancoLimpo, ctxDe, novoCliente, uuid, pool } from './helpers.js';
import * as cartoes from '../src/modules/cartoes.service.js';
import { estornar } from '../src/modules/estornos.service.js';
import type { Contexto } from '../src/lib/contexto.js';
import { competenciaVigente } from '../src/lib/datas.js';

let op: Contexto, ger: Contexto;
beforeAll(async () => { await bancoLimpo(); op = await ctxDe('operador'); ger = await ctxDe('gerente'); });
afterAll(async () => { await pool.end(); });

const saldo = async (id: string) => (await pool.query('SELECT saldo FROM cartoes_cliente WHERE id=$1', [id])).rows[0].saldo;
let seq = 0;
const ident = () => `CARD-${Date.now()}-${seq++}`;

describe('competência do ciclo', () => {
  it('antes do dia de virada ainda vale o ciclo anterior', () => {
    expect(competenciaVigente(new Date(2026, 0, 4), 5)).toBe('2025-12');
    expect(competenciaVigente(new Date(2026, 0, 5), 5)).toBe('2026-01');
  });
});

describe('cartões', () => {
  it('operador não cadastra cartão; gerente cadastra com saldo = limite', async () => {
    const c = await novoCliente();
    await expect(cartoes.criarCartao(op, { cliente_id: c.id, identificador: ident(), limite_recorrente: 100, dia_virada: 1 }))
      .rejects.toMatchObject({ codigo: 'SEM_PERMISSAO' });
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: ident(), limite_recorrente: 100, dia_virada: 1 });
    expect(await saldo(k.id)).toBe('100.00');
  });

  it('compra respeita saldo e recusa sem debitar (RN-08)', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    await cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 70 });
    await expect(cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 30.01 }))
      .rejects.toMatchObject({ codigo: 'SALDO_INSUFICIENTE' });
    expect(await saldo(k.id)).toBe('30.00');
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM transacoes WHERE cartao_id=$1 AND tipo='compra_cartao'`, [k.id])).rows[0].n;
    expect(n).toBe(1);
  });

  it('cartão bloqueado não autoriza compra (RN-07)', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    await cartoes.alterarStatusCartao(ger, k.id, 'bloquear');
    await expect(cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 1 })).rejects.toMatchObject({ codigo: 'CARTAO_NAO_ATIVO' });
    await cartoes.alterarStatusCartao(ger, k.id, 'desbloquear');
    await cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 1 });
  });

  it('concorrência no cartão: só uma das compras passa', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    const rs = await Promise.allSettled([1, 2, 3].map(() => cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 40 })));
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await saldo(k.id)).toBe('20.00');
  });

  it('virada substitui o saldo e é idempotente (RN-09)', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    await cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 80 });
    // Simula que o ciclo atual é antigo.
    await pool.query(`UPDATE ciclos_cartao SET competencia = '2020-01' WHERE cartao_id = $1`, [k.id]);
    await pool.query(`UPDATE cartoes_cliente SET ciclo_atual = '2020-01' WHERE id = $1`, [k.id]);
    const a = await cartoes.processarViradas();
    const b = await cartoes.processarViradas();
    expect(a.processadas).toBeGreaterThanOrEqual(1);
    expect(b.processadas).toBe(0);
    expect(await saldo(k.id)).toBe('100.00');
    const ciclos = (await pool.query('SELECT competencia FROM ciclos_cartao WHERE cartao_id=$1 ORDER BY competencia', [k.id])).rows;
    expect(ciclos).toHaveLength(2);
    // Virada manual repetida também não processa de novo.
    expect((await cartoes.viradaCartao(ger, k.id)).processada).toBe(false);
  });

  it('segunda via inativa o anterior e herda saldo', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    const compra = await cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 25 });
    const novo = await cartoes.segundaVia(ger, k.id, { novo_identificador: ident(), motivo: 'perdeu o cartão' });
    expect(novo.saldo).toBe('75.00');
    await expect(cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 1 })).rejects.toMatchObject({ codigo: 'CARTAO_NAO_ATIVO' });
    // Estorno da compra feita no cartão antigo volta para o cartão vigente.
    await estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'devolução' });
    expect(await saldo(novo.id)).toBe('100.00');
    const util = (await pool.query('SELECT valor_utilizado FROM ciclos_cartao WHERE cartao_id=$1', [novo.id])).rows[0].valor_utilizado;
    expect(util).toBe('0.00');
  });

  it('estorno de compra de ciclo encerrado é recusado', async () => {
    const c = await novoCliente();
    const id = ident();
    const k = await cartoes.criarCartao(ger, { cliente_id: c.id, identificador: id, limite_recorrente: 100, dia_virada: 1 });
    const compra = await cartoes.compraCartao(op, { uuid_operacao: uuid(), identificador: id, valor: 10 });
    await pool.query(`UPDATE cartoes_cliente SET ciclo_atual = '2099-01' WHERE id = $1`, [k.id]);
    await expect(estornar(ger, compra.transacao.id, { uuid_operacao: uuid(), motivo: 'x' })).rejects.toMatchObject({ codigo: 'CICLO_ENCERRADO' });
  });
});
