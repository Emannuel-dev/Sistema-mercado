import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AlertCircle, Search, X } from 'lucide-react';
import { toast } from 'sonner';
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

/**
 * Diálogo acessível (base-ui): foco preso, Esc fecha, animação curta de entrada
 * e saída mais rápida. Os botões "Cancelar" usam <BotaoFechar> para animar a saída.
 */
export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const [aberto, setAberto] = useState(true);
  return (
    <Dialog.Root open={aberto} onOpenChange={(o) => { if (!o) setAberto(false); }} onOpenChangeComplete={(o) => { if (!o) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-fundo" />
        <Dialog.Popup className="dlg">
          <div className="dlg-topo">
            <Dialog.Title render={<h2 />}>{titulo}</Dialog.Title>
            <Dialog.Close className="btn-icone" aria-label="Fechar"><X size={18} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const BotaoFechar = ({ children }: { children: ReactNode }) => <Dialog.Close className="btn">{children}</Dialog.Close>;

/** Campo de busca com atalho "/" (sem animação: é uma ação de teclado frequente). */
export function Busca({ valor, aoMudar, placeholder, autoFocus }: { valor: string; aoMudar: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  return (
    <div className="busca-wrap">
      <Search size={16} />
      <input ref={ref} autoFocus={autoFocus} value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {!valor && <kbd className="esconder-mobile">/</kbd>}
    </div>
  );
}

export const iniciais = (nome?: string) => (nome ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const ROTULOS_SELO: Record<string, string> = {
  requer_revisao: 'requer revisão', ativa: 'liberado', bloqueada: 'bloqueado', confirmada: 'confirmada',
};

export const Erro = ({ msg }: { msg: string | null }) => (msg ? <div className="alerta erro" role="alert"><AlertCircle size={16} />{msg}</div> : null);
const frase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const Selo = ({ s, texto }: { s: string; texto?: string }) => <span className={`selo selo-${s}`}>{frase(texto ?? ROTULOS_SELO[s] ?? s.replace('_', ' '))}</span>;

export const Tabela = ({ children }: { children: ReactNode }) => <div className="tabela-wrap"><div className="tabela-rolagem"><table className="tabela">{children}</table></div></div>;

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return <label className="campo"><span>{rotulo}</span>{children}{dica && <small>{dica}</small>}</label>;
}

/** Resultado de operação: pendente offline vira aviso, o resto vira sucesso. */
export const avisarResultado = (msg: string) => (msg.startsWith('Sem conexão') ? toast.warning(msg) : toast.success(msg));
