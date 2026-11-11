import { useState } from 'react';
import { post } from '../api';
import { useAuth } from '../auth';
import { Campo, Erro, mensagemErro } from '../ui';

export default function TrocarSenha({ obrigatoria = false }: { obrigatoria?: boolean }) {
  const { recarregar, sair } = useAuth();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nova !== conf) return setErro('As senhas não conferem.');
    try { await post('/auth/trocar-senha', { senha_atual: atual, nova_senha: nova }); setOk(true); setErro(null); await recarregar(); }
    catch (e) { setErro(mensagemErro(e)); }
  };

  return (
    <div className={obrigatoria ? 'login' : ''}>
      <form className={`form ${obrigatoria ? 'cartao-login' : 'painel estreito'}`} onSubmit={enviar}>
        <h2>Trocar senha</h2>
        {obrigatoria && <p className="muted">Por segurança, defina uma nova senha antes de continuar.</p>}
        <Campo rotulo="Senha atual"><input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} required /></Campo>
        <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres."><input type="password" value={nova} onChange={(e) => setNova(e.target.value)} minLength={8} required /></Campo>
        <Campo rotulo="Confirme a nova senha"><input type="password" value={conf} onChange={(e) => setConf(e.target.value)} required /></Campo>
        <Erro msg={erro} />
        {ok && <div className="alerta ok">Senha alterada.</div>}
        <div className="acoes">{obrigatoria && <button type="button" className="btn" onClick={sair}>Sair</button>}<button className="btn primario">Salvar</button></div>
      </form>
    </div>
  );
}
