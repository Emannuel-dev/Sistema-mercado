import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { useAuth } from '../auth';
import { db, sincronizar, useEstadoSync, type OperacaoLocal } from '../offline';
import { brl, dataBR, useCarregar, Erro, Modal, Campo, mensagemErro, Selo, TIPOS } from '../ui';

export function Usuarios() {
  const { usuario } = useAuth();
  const { dados, erro, recarregar } = useCarregar(() => get('/usuarios'));
  const [novo, setNovo] = useState(false);
  const [senha, setSenha] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const alterar = async (u: any, corpo: any) => { try { await put(`/usuarios/${u.id}`, corpo); recarregar(); } catch (e) { setMsg(mensagemErro(e)); } };
  return (
    <div>
      <div className="topo-pagina"><h1>Usuários</h1><button className="btn primario" onClick={() => setNovo(true)}>+ Novo usuário</button></div>
      <Erro msg={erro ?? msg} />
      <table className="tabela"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>{(dados ?? []).map((u: any) => (
          <tr key={u.id}><td>{u.nome}</td><td>{u.login}</td>
            <td><select value={u.perfil} disabled={u.id === usuario?.id} onChange={(e) => alterar(u, { perfil: e.target.value })}><option value="operador">Operador</option><option value="gerente">Gerente</option><option value="administrador">Administrador</option></select></td>
            <td><Selo s={u.ativo ? 'ativo' : 'inativo'} /></td><td>{dataBR(u.ultimo_acesso)}</td>
            <td className="acoes-linha">{u.id !== usuario?.id && <button className="btn pequeno" onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Reativar'}</button>}
              <button className="btn pequeno" onClick={() => setSenha(u)}>Redefinir senha</button></td></tr>
        ))}</tbody></table>
      <p className="muted pequeno">Usuários desativados não entram no sistema, mas o histórico de operações deles é mantido.</p>
      {novo && <NovoUsuario aoFechar={() => setNovo(false)} ok={() => { setNovo(false); recarregar(); }} />}
      {senha && <RedefinirSenha u={senha} aoFechar={() => setSenha(null)} />}
    </div>
  );
}

function NovoUsuario({ aoFechar, ok }: any) {
  const [f, setF] = useState({ nome: '', login: '', senha_temporaria: '', perfil: 'operador' });
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo="Novo usuário" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post('/usuarios', f); ok(); } catch (e) { setErro(mensagemErro(e)); } }}>
        <Campo rotulo="Nome"><input value={f.nome} onChange={set('nome')} required /></Campo>
        <Campo rotulo="Login"><input value={f.login} onChange={set('login')} required /></Campo>
        <Campo rotulo="Senha temporária" dica="O usuário deverá trocá-la no primeiro acesso."><input value={f.senha_temporaria} onChange={set('senha_temporaria')} minLength={8} required /></Campo>
        <Campo rotulo="Perfil"><select value={f.perfil} onChange={set('perfil')}><option value="operador">Operador</option><option value="gerente">Gerente</option><option value="administrador">Administrador</option></select></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario">Criar</button></div>
      </form>
    </Modal>
  );
}

function RedefinirSenha({ u, aoFechar }: any) {
  const [s, setS] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <Modal titulo={`Redefinir senha · ${u.nome}`} aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post(`/usuarios/${u.id}/redefinir-senha`, { senha_temporaria: s }); setOk(true); } catch (e) { setErro(mensagemErro(e)); } }}>
        <Campo rotulo="Nova senha temporária"><input value={s} onChange={(e) => setS(e.target.value)} minLength={8} required /></Campo>
        <Erro msg={erro} />{ok && <div className="alerta ok">Senha redefinida. Ela será trocada no próximo acesso.</div>}
        <div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Fechar</button>{!ok && <button className="btn primario">Redefinir</button>}</div>
      </form>
    </Modal>
  );
}

export function Sincronizacao() {
  const est = useEstadoSync();
  const { pode } = useAuth();
  const [fila, setFila] = useState<OperacaoLocal[]>([]);
  const servidor = useCarregar(() => (pode('auditoria.ver') ? get('/sync/pendencias') : Promise.resolve([])), [est.pendentes]);
  useEffect(() => { db.fila.orderBy('criado_em').reverse().limit(200).toArray().then(setFila); }, [est.pendentes, est.problemas, est.ultima]);
  return (
    <div>
      <div className="topo-pagina"><h1>Sincronização</h1><button className="btn primario" onClick={() => sincronizar()} disabled={!est.online}>Sincronizar agora</button></div>
      <div className="kpis">
        <div className={`kpi ${est.online ? '' : 'alerta-kpi'}`}><span>Conexão</span><strong>{est.online ? 'Online' : 'Offline'}</strong></div>
        <div className="kpi"><span>Pendentes neste caixa</span><strong>{est.pendentes}</strong></div>
        <div className={`kpi ${est.problemas ? 'alerta-kpi' : ''}`}><span>Precisam de revisão</span><strong>{est.problemas}</strong></div>
        <div className="kpi"><span>Última sincronização</span><strong className="menor">{dataBR(est.ultima)}</strong></div>
      </div>
      <section className="painel"><h2>Operações registradas offline neste caixa</h2>
        <table className="tabela"><thead><tr><th>Criada em</th><th>Operação</th><th>Cliente</th><th className="num">Valor</th><th>Situação</th><th>Motivo</th></tr></thead>
          <tbody>{fila.map((o) => (
            <tr key={o.uuid_operacao}><td>{dataBR(o.criado_em)}</td><td>{TIPOS[o.tipo]}</td><td>{o.cliente_nome}</td><td className="num">{brl(o.payload.valor as number)}</td><td><Selo s={o.status} /></td><td className="pequeno">{o.erro ?? ''}</td></tr>
          ))}{fila.length === 0 && <tr><td colSpan={6} className="muted centro">Nenhuma operação offline.</td></tr>}</tbody></table>
        <p className="muted pequeno">Operações "requer revisão" foram recusadas pelo servidor (ex.: limite estourado enquanto estava offline). O saldo não foi alterado; registre novamente se for o caso.</p>
      </section>
      {pode('auditoria.ver') && <section className="painel"><h2>Pendências de todos os caixas (servidor)</h2>
        <table className="tabela"><tbody>{(servidor.dados ?? []).map((p: any) => (
          <tr key={p.id}><td>{dataBR(p.criado_em)}</td><td>{p.dispositivo_nome ?? '—'}</td><td>{p.usuario_nome}</td><td>{TIPOS[p.tipo]}</td><td><Selo s={p.status} /></td><td className="pequeno">{p.erro}</td></tr>
        ))}{servidor.dados?.length === 0 && <tr><td className="muted centro">Nenhuma pendência.</td></tr>}</tbody></table></section>}
    </div>
  );
}

const ROTULOS: Record<string, [string, string]> = {
  prazo_vencimento_dias: ['Prazo padrão de vencimento (dias)', 'Usado quando a compra fiada não informa vencimento.'],
  limite_fiado_padrao: ['Limite de fiado padrão (R$)', 'Aplicado a clientes novos.'],
  alerta_limite_percentual: ['Alerta de limite (%)', 'Avisa quando o cliente usar esse percentual do limite.'],
  alerta_vencimento_dias: ['Alerta de vencimento (dias)', 'Mostra no dashboard débitos que vencem nesse prazo.'],
  sessao_minutos: ['Sessão expira após (minutos sem uso)', ''],
};

export function Configuracoes() {
  const { pode } = useAuth();
  const { dados, erro, recarregar } = useCarregar(() => get('/configuracoes'));
  const [f, setF] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [comprovante, setComprovante] = useState(localStorage.getItem('mercadinho.comprovante_auto') !== 'nao');
  useEffect(() => { if (dados) setF(dados); }, [dados]);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await put('/configuracoes', Object.fromEntries(Object.keys(ROTULOS).map((k) => [k, Number(String(f[k]).replace(',', '.'))]))); setMsg('Configurações salvas.'); recarregar(); }
    catch (e) { setMsg(mensagemErro(e)); }
  };
  return (
    <div>
      <div className="topo-pagina"><h1>Configurações</h1></div>
      <Erro msg={erro} />
      <form className="form painel estreito" onSubmit={salvar}>
        <h2>Regras do estabelecimento</h2>
        {Object.entries(ROTULOS).map(([k, [r, d]]) => (
          <Campo key={k} rotulo={r} dica={d}><input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!pode('configuracoes.gerenciar')} /></Campo>))}
        <p className="muted pequeno">Virada do cartão: o saldo que sobrou é substituído pelo novo limite (não acumula).</p>
        {msg && <div className="alerta ok">{msg}</div>}
        {pode('configuracoes.gerenciar') && <div className="acoes"><button className="btn primario">Salvar</button></div>}
      </form>
      <section className="painel estreito"><h2>Este computador</h2>
        <label className="check"><input type="checkbox" checked={comprovante} onChange={(e) => { setComprovante(e.target.checked); localStorage.setItem('mercadinho.comprovante_auto', e.target.checked ? 'sim' : 'nao'); }} /> Abrir comprovante para impressão após cada operação</label>
      </section>
    </div>
  );
}
