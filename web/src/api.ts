// Cliente HTTP da API. Todas as operações remotas passam por aqui.

export class ErroApi extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public detalhes?: any) {
    super(mensagem);
  }
}
/** Falha de rede (sem conexão com o servidor). */
export class SemConexao extends Error {
  constructor() { super('Sem conexão com o servidor'); }
}

const CHAVE_TOKEN = 'mercadinho.token';
export const tokenAtual = () => localStorage.getItem(CHAVE_TOKEN);
export const salvarToken = (t: string | null) => (t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN));

export function idDispositivo() {
  let id = localStorage.getItem('mercadinho.dispositivo');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('mercadinho.dispositivo', id); }
  return id;
}
export const nomeDispositivo = () => localStorage.getItem('mercadinho.dispositivo_nome') ?? 'Caixa';

let aoExpirar: () => void = () => {};
export const definirAoExpirar = (fn: () => void) => { aoExpirar = fn; };

export async function api<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(tokenAtual() ? { Authorization: `Bearer ${tokenAtual()}` } : {}),
        'X-Dispositivo': idDispositivo(),
        'X-Dispositivo-Nome': nomeDispositivo(),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new SemConexao();
  }
  if (r.status === 502 || r.status === 503 || r.status === 504) throw new SemConexao();
  const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && caminho !== '/auth/login') aoExpirar();
    throw new ErroApi(r.status, dados?.codigo ?? 'ERRO', dados?.mensagem ?? `Erro ${r.status}`, dados?.detalhes);
  }
  return dados as T;
}

export const get = <T = any>(c: string) => api<T>('GET', c);
export const post = <T = any>(c: string, b?: unknown) => api<T>('POST', c, b ?? {});
export const put = <T = any>(c: string, b?: unknown) => api<T>('PUT', c, b ?? {});

export function qs(p: Record<string, unknown>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}
