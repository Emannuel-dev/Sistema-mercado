import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bancoLimpo, criarApp, uuid, pool } from './helpers.js';

let app: FastifyInstance;
let tokenAdmin = '';
let tokenOp = '';

const req = (method: string, url: string, token?: string, body?: unknown) =>
  app.inject({ method: method as any, url, payload: body as any, headers: token ? { authorization: `Bearer ${token}`, 'x-dispositivo': 'caixa-1' } : {} });

beforeAll(async () => {
  await bancoLimpo();
  app = await criarApp();
  const r = await req('POST', '/api/auth/login', undefined, { login: 'admin', senha: 'admin123' });
  tokenAdmin = r.json().token;
  await req('POST', '/api/usuarios', tokenAdmin, { nome: 'Maria', login: 'maria', senha_temporaria: 'senha1234', perfil: 'operador' });
  tokenOp = (await req('POST', '/api/auth/login', undefined, { login: 'maria', senha: 'senha1234' })).json().token;
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('API', () => {
  it('rejeita sem login e com senha errada', async () => {
    expect((await req('GET', '/api/clientes')).statusCode).toBe(401);
    expect((await req('POST', '/api/auth/login', undefined, { login: 'admin', senha: 'errada' })).statusCode).toBe(401);
  });

  it('permissão é checada no back-end (operador não gerencia usuários)', async () => {
    expect((await req('GET', '/api/usuarios', tokenOp)).statusCode).toBe(403);
    expect((await req('GET', '/api/usuarios', tokenAdmin)).statusCode).toBe(200);
  });

  it('fluxo completo: cadastro, duplicidade, compra, pagamento, detalhe e dashboard', async () => {
    const c = await req('POST', '/api/clientes', tokenOp, { nome: 'João da Silva', telefone: '(11) 98888-7777', limite_fiado: 150 });
    expect(c.statusCode).toBe(201);
    const dup = await req('POST', '/api/clientes', tokenOp, { nome: 'João S.', telefone: '11988887777' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('POSSIVEL_DUPLICIDADE');

    const id = c.json().id;
    const compra = await req('POST', '/api/fiado/compras', tokenOp, { uuid_operacao: uuid(), cliente_id: id, valor: 42.5, descricao: 'arroz' });
    expect(compra.statusCode).toBe(201);
    const pag = await req('POST', '/api/fiado/pagamentos', tokenOp, { uuid_operacao: uuid(), cliente_id: id, valor: 12.5, meio_pagamento: 'dinheiro' });
    expect(pag.statusCode).toBe(201);

    const det = (await req('GET', `/api/clientes/${id}`, tokenOp)).json();
    expect(det.saldo_devedor).toBe('30.00');
    expect(det.fiado.total).toBe('30.00');
    expect(det.transacoes).toHaveLength(2);

    const busca = (await req('GET', '/api/clientes?busca=98888', tokenOp)).json();
    expect(busca.itens.map((x: any) => x.id)).toContain(id);

    const dash = await req('GET', '/api/dashboard', tokenAdmin);
    expect(dash.statusCode).toBe(200);
    expect(dash.json().fiado.em_aberto).toBe('30.00');
    expect(dash.json().movimento.recebido_hoje).toBe('12.50');
    expect((await req('GET', '/api/dashboard', tokenOp)).statusCode).toBe(403);
  });

  it('valida entrada (valor negativo, 3 casas decimais)', async () => {
    const c = (await req('POST', '/api/clientes', tokenOp, { nome: 'Ana', telefone: '11977776666' })).json();
    expect((await req('POST', '/api/fiado/compras', tokenOp, { uuid_operacao: uuid(), cliente_id: c.id, valor: -5 })).statusCode).toBe(400);
    expect((await req('POST', '/api/fiado/compras', tokenOp, { uuid_operacao: uuid(), cliente_id: c.id, valor: 1.234 })).statusCode).toBe(400);
  });

  it('sincronização offline: idempotente e marca conflito para revisão', async () => {
    const c = (await req('POST', '/api/clientes', tokenOp, { nome: 'Pedro', telefone: '11955554444', limite_fiado: 50 })).json();
    const op1 = { uuid_operacao: uuid(), tipo: 'compra_fiado', criado_em: new Date().toISOString(), payload: { cliente_id: c.id, valor: 30 } };
    const op2 = { uuid_operacao: uuid(), tipo: 'compra_fiado', criado_em: new Date().toISOString(), payload: { cliente_id: c.id, valor: 30 } };
    const r1 = (await req('POST', '/api/sync/operacoes', tokenOp, { operacoes: [op1, op2] })).json();
    expect(r1.resultados.map((r: any) => r.status)).toEqual(['sincronizada', 'requer_revisao']);
    expect(r1.resultados[1].erro).toMatch(/LIMITE_EXCEDIDO/);
    // Reenvio da mesma operação (perda de conexão antes da resposta)
    const r2 = (await req('POST', '/api/sync/operacoes', tokenOp, { operacoes: [op1] })).json();
    expect(r2.resultados[0]).toMatchObject({ status: 'sincronizada', repetida: true });
    const det = (await req('GET', `/api/clientes/${c.id}`, tokenOp)).json();
    expect(det.saldo_devedor).toBe('30.00');
    expect(det.transacoes[0].origem).toBe('offline');
    const pend = (await req('GET', '/api/sync/pendencias', tokenAdmin)).json();
    expect(pend.some((p: any) => p.uuid_operacao === op2.uuid_operacao)).toBe(true);
  });
});
