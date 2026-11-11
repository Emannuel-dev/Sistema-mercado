// Offline-First (seção 11): fila local de operações em IndexedDB via Dexie.
import Dexie, { type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { post, get, SemConexao, ErroApi } from './api';

export type TipoOp = 'compra_fiado' | 'pagamento_fiado';
export type StatusOp = 'pendente' | 'enviando' | 'sincronizada' | 'rejeitada' | 'requer_revisao';

export interface OperacaoLocal {
  uuid_operacao: string;
  tipo: TipoOp;
  payload: Record<string, unknown>;
  criado_em: string;
  status: StatusOp;
  tentativas: number;
  erro?: string | null;
  cliente_nome?: string;
}

export interface ClienteCache {
  id: string; nome: string; telefone: string; cpf: string | null; status: string;
  limite: string; saldo_devedor: string; credito_status: string;
}

class Banco extends Dexie {
  fila!: Table<OperacaoLocal, string>;
  clientes!: Table<ClienteCache, string>;
  meta!: Table<{ chave: string; valor: any }, string>;
  constructor() {
    super('mercadinho');
    this.version(1).stores({ fila: 'uuid_operacao, status, criado_em', clientes: 'id, nome, telefone', meta: 'chave' });
  }
}
export const db = new Banco();

/**
 * Registra uma operação financeira. Online: envia direto. Sem conexão: grava na fila
 * local como "pendente" (nunca como confirmada) para enviar depois com o mesmo UUID.
 */
export async function registrarOperacao(tipo: TipoOp, payload: Record<string, unknown>, clienteNome?: string) {
  const uuid_operacao = (payload.uuid_operacao as string) ?? crypto.randomUUID();
  const corpo = { ...payload, uuid_operacao };
  const rota = tipo === 'compra_fiado' ? '/fiado/compras' : '/fiado/pagamentos';
  try {
    const r = await post(rota, corpo);
    return { pendente: false as const, resultado: r };
  } catch (e) {
    if (!(e instanceof SemConexao)) throw e;
    const { uuid_operacao: _u, ...resto } = corpo;
    await db.fila.put({
      uuid_operacao, tipo, payload: resto, criado_em: new Date().toISOString(),
      status: 'pendente', tentativas: 0, cliente_nome: clienteNome,
    });
    avisar();
    return { pendente: true as const, uuid_operacao };
  }
}

let sincronizando = false;
export async function sincronizar() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const pend = await db.fila.where('status').anyOf('pendente', 'enviando').sortBy('criado_em');
    for (let i = 0; i < pend.length; i += 50) {
      const lote = pend.slice(i, i + 50);
      await db.fila.bulkPut(lote.map((o) => ({ ...o, status: 'enviando' as const, tentativas: o.tentativas + 1 })));
      try {
        const r = await post<{ resultados: { uuid_operacao: string; status: StatusOp; erro?: string }[] }>('/sync/operacoes', {
          operacoes: lote.map((o) => ({ uuid_operacao: o.uuid_operacao, tipo: o.tipo, criado_em: o.criado_em, payload: o.payload })),
        });
        for (const res of r.resultados) await db.fila.update(res.uuid_operacao, { status: res.status, erro: res.erro ?? null });
      } catch (e) {
        // Volta para pendente; o servidor garante que reenvios não duplicam.
        await db.fila.bulkPut(lote.map((o) => ({ ...o, status: 'pendente' as const, tentativas: o.tentativas + 1,
          erro: e instanceof ErroApi ? e.message : null })));
        if (e instanceof SemConexao) break;
      }
    }
    await db.meta.put({ chave: 'ultima_sync', valor: new Date().toISOString() });
    await atualizarSnapshot();
  } finally {
    sincronizando = false;
    avisar();
  }
}

export async function atualizarSnapshot() {
  try {
    const s = await get<{ clientes: ClienteCache[]; gerado_em: string }>('/sync/snapshot');
    await db.transaction('rw', db.clientes, db.meta, async () => {
      await db.clientes.clear();
      await db.clientes.bulkPut(s.clientes);
      await db.meta.put({ chave: 'snapshot_em', valor: s.gerado_em });
    });
  } catch { /* sem conexão: mantém o cache anterior */ }
}

export async function buscarClientesOffline(texto: string) {
  const t = texto.trim().toLowerCase();
  const dig = t.replace(/\D/g, '');
  return (await db.clientes.toArray())
    .filter((c) => c.nome.toLowerCase().includes(t) || (dig.length >= 3 && (c.telefone.includes(dig) || (c.cpf ?? '').includes(dig))))
    .sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 50);
}

// Pequeno "event bus" para a UI reagir a mudanças da fila e da conexão.
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function useEstadoSync() {
  const [estado, setEstado] = useState({ online: navigator.onLine, pendentes: 0, problemas: 0, ultima: null as string | null });
  useEffect(() => {
    const atualizar = async () => {
      const pendentes = await db.fila.where('status').anyOf('pendente', 'enviando').count();
      const problemas = await db.fila.where('status').anyOf('rejeitada', 'requer_revisao').count();
      const ultima = (await db.meta.get('ultima_sync'))?.valor ?? null;
      setEstado({ online: navigator.onLine, pendentes, problemas, ultima });
    };
    ouvintes.add(atualizar);
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    atualizar();
    return () => { ouvintes.delete(atualizar); window.removeEventListener('online', atualizar); window.removeEventListener('offline', atualizar); };
  }, []);
  return estado;
}

/** Inicia o ciclo automático de sincronização. */
export function iniciarSincronizacao() {
  window.addEventListener('online', () => sincronizar());
  const id = setInterval(() => { if (navigator.onLine) sincronizar(); }, 20_000);
  sincronizar();
  return () => clearInterval(id);
}
