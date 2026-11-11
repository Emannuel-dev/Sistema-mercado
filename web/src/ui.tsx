import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ErroApi, SemConexao } from './api';

export const brl = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const dataBR = (v?: string | null) => {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [a, m, d] = v.split('-'); return `${d}/${m}/${a}`; }
  return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export const telefoneBR = (t?: string | null) => {
  const d = (t ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? '';
};

export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const TIPOS: Record<string, string> = {
  compra_fiado: 'Compra fiada', pagamento_fiado: 'Pagamento', compra_cartao: 'Compra no cartão',
  virada_cartao: 'Virada do cartão', estorno: 'Estorno',
};

export const mensagemErro = (e: unknown) =>
  e instanceof SemConexao ? 'Sem conexão com o servidor.' : e instanceof ErroApi ? e.message : 'Erro inesperado.';

/** Converte "12,50" ou "12.50" em número; NaN se inválido. */
export const lerValor = (s: string) => {
  const t = s.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
};

export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try { setDados(await fn()); setErro(null); } catch (e) { setErro(mensagemErro(e)); } finally { setCarregando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recarregar(); }, [recarregar]);
  return { dados, erro, carregando, recarregar };
}

export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [aoFechar]);
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo"><h2>{titulo}</h2><button className="btn-icone" onClick={aoFechar} aria-label="Fechar">×</button></div>
        {children}
      </div>
    </div>
  );
}

export const Erro = ({ msg }: { msg: string | null }) => (msg ? <div className="alerta erro" role="alert">{msg}</div> : null);
export const Selo = ({ s }: { s: string }) => <span className={`selo selo-${s}`}>{s.replace('_', ' ')}</span>;

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return <label className="campo"><span>{rotulo}</span>{children}{dica && <small>{dica}</small>}</label>;
}
