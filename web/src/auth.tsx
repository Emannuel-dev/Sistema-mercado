import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { get, post, salvarToken, tokenAtual, definirAoExpirar } from './api';
import { atualizarSnapshot } from './offline';

export interface Usuario { id: string; nome: string; login: string; perfil: string; permissoes: string[]; trocar_senha: boolean }

interface Ctx {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => void;
  pode: (p: string) => boolean;
  recarregar: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

const CHAVE_USUARIO = 'mercadinho.usuario';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    try { return tokenAtual() ? JSON.parse(localStorage.getItem(CHAVE_USUARIO) ?? 'null') : null; } catch { return null; }
  });
  const [carregando, setCarregando] = useState(!!tokenAtual());
  const ultimaAtividade = useRef(Date.now());
  const minutosSessao = useRef(30);

  const sair = useCallback(() => {
    salvarToken(null);
    localStorage.removeItem(CHAVE_USUARIO);
    setUsuario(null);
  }, []);

  const definirUsuario = (u: Usuario) => { localStorage.setItem(CHAVE_USUARIO, JSON.stringify(u)); setUsuario(u); };

  const recarregar = useCallback(async () => {
    try { definirUsuario(await get<Usuario>('/auth/eu')); } catch { /* offline: mantém o usuário em cache */ }
  }, []);

  useEffect(() => {
    definirAoExpirar(sair);
    if (tokenAtual()) recarregar().finally(() => setCarregando(false));
  }, [recarregar, sair]);

  // Expiração por inatividade + renovação enquanto o operador está usando o sistema.
  useEffect(() => {
    if (!usuario) return;
    const marcar = () => { ultimaAtividade.current = Date.now(); };
    ['click', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, marcar));
    const id = setInterval(async () => {
      const inativoMin = (Date.now() - ultimaAtividade.current) / 60000;
      if (inativoMin >= minutosSessao.current) { sair(); return; }
      if (navigator.onLine) {
        try {
          const r = await post<{ token: string; expira_em_minutos: number }>('/auth/renovar');
          salvarToken(r.token);
          minutosSessao.current = r.expira_em_minutos;
        } catch { /* tratado pelo aoExpirar */ }
      }
    }, 4 * 60_000);
    return () => { clearInterval(id); ['click', 'keydown', 'touchstart'].forEach((e) => window.removeEventListener(e, marcar)); };
  }, [usuario, sair]);

  const entrar = async (login: string, senha: string) => {
    const r = await post<{ token: string; usuario: Usuario; expira_em_minutos: number }>('/auth/login', { login, senha });
    salvarToken(r.token);
    minutosSessao.current = r.expira_em_minutos;
    ultimaAtividade.current = Date.now();
    definirUsuario(r.usuario);
    atualizarSnapshot();
  };

  const pode = (p: string) => !!usuario?.permissoes.includes(p);

  return <AuthCtx.Provider value={{ usuario, carregando, entrar, sair, pode, recarregar }}>{children}</AuthCtx.Provider>;
}
