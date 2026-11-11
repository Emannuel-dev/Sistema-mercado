import { useState } from 'react';
import { useAuth } from '../auth';
import { Campo, Erro, mensagemErro } from '../ui';
import { nomeDispositivo } from '../api';
import { Store } from 'lucide-react';

export default function Login() {
  const { entrar } = useAuth();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [disp, setDisp] = useState(nomeDispositivo());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true); setErro(null);
    localStorage.setItem('mercadinho.dispositivo_nome', disp.trim() || 'Caixa');
    try { await entrar(login.trim().toLowerCase(), senha); } catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
  };

  return (
    <div className="login">
      <form className="cartao-login form" onSubmit={enviar}>
        <div className="marca"><span className="marca-icone"><Store size={16} /></span><div>Mercadinho<small>Fiados e cartões</small></div></div>
        <div><h1>Entrar</h1><p className="muted">Use o seu usuário do caixa.</p></div>
        <Campo rotulo="Usuário"><input autoFocus value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Campo>
        <Campo rotulo="Senha"><input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></Campo>
        <Campo rotulo="Este computador" dica="Identifica o caixa nas operações."><input value={disp} onChange={(e) => setDisp(e.target.value)} /></Campo>
        <Erro msg={erro} />
        <button className="btn primario grande" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        <p className="sutil pequeno centro">Esqueceu a senha? Peça ao administrador para redefinir seu acesso.</p>
      </form>
    </div>
  );
}
