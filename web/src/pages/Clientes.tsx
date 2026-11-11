import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, qs, SemConexao } from '../api';
import { useAuth } from '../auth';
import { buscarClientesOffline, db } from '../offline';
import { CompraFiadoModal, PagamentoModal } from '../operacoes';
import { brl, telefoneBR, Selo, Erro, mensagemErro } from '../ui';
import { ClienteForm } from './ClienteForm';

export default function Clientes() {
  const { pode } = useAuth();
  const nav = useNavigate();
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [situacao, setSituacao] = useState('');
  const [itens, setItens] = useState<any[]>([]);
  const [offline, setOffline] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [compra, setCompra] = useState<any>(null);
  const [pag, setPag] = useState<any>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await get(`/clientes${qs({ busca, status, situacao, limite: 100 })}`);
        setItens(r.itens); setOffline(false); setErro(null);
        // Mantém o cache local atualizado para atendimento sem internet.
        db.clientes.bulkPut(r.itens.map(({ vencido, ...c }: any) => c)).catch(() => {});
      } catch (e) {
        if (e instanceof SemConexao) { setOffline(true); setItens(await buscarClientesOffline(busca)); }
        else setErro(mensagemErro(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [busca, status, situacao, versao]);

  const concluir = (msg: string) => { setCompra(null); setPag(null); setAviso(msg); setVersao((v) => v + 1); };

  return (
    <div>
      <div className="topo-pagina"><h1>Clientes</h1>{pode('clientes.editar') && <button className="btn primario" onClick={() => setNovo(true)}>+ Novo cliente</button>}</div>
      {aviso && <div className="alerta ok" onClick={() => setAviso(null)}>{aviso}</div>}
      {offline && <div className="alerta aviso">Sem conexão: mostrando a última cópia local. Compras e pagamentos ficam pendentes até sincronizar.</div>}
      <div className="filtros">
        <input className="busca" autoFocus placeholder="Buscar por nome, telefone, CPF ou nº do cartão" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="bloqueado">Bloqueados</option></select>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação"><option value="">Qualquer situação</option><option value="com_saldo">Com saldo devedor</option><option value="inadimplente">Inadimplentes</option></select>
      </div>
      <Erro msg={erro} />
      <table className="tabela">
        <thead><tr><th>Nome</th><th>Telefone</th><th>Status</th><th className="num">Devendo</th><th className="num">Limite</th><th></th></tr></thead>
        <tbody>
          {itens.map((c) => (
            <tr key={c.id} className="clicavel" onClick={() => !offline && nav(`/clientes/${c.id}`)}>
              <td>{offline ? c.nome : <Link to={`/clientes/${c.id}`}>{c.nome}</Link>}{Number(c.vencido) > 0 && <span className="selo selo-vencido">vencido</span>}{c.credito_status === 'bloqueada' && <span className="selo selo-bloqueado">crédito bloqueado</span>}</td>
              <td>{telefoneBR(c.telefone)}</td><td><Selo s={c.status} /></td>
              <td className="num">{brl(c.saldo_devedor)}</td><td className="num muted">{brl(c.limite)}</td>
              <td className="acoes-linha" onClick={(e) => e.stopPropagation()}>
                {pode('fiado.lancar') && <button className="btn pequeno" disabled={c.status !== 'ativo'} onClick={() => setCompra(c)}>Compra</button>}
                {pode('fiado.pagamento') && <button className="btn pequeno" disabled={Number(c.saldo_devedor) <= 0 && !offline} onClick={() => setPag(c)}>Pagamento</button>}
              </td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={6} className="muted centro">Nenhum cliente encontrado.</td></tr>}
        </tbody>
      </table>
      {novo && <ClienteForm aoFechar={() => setNovo(false)} aoSalvar={(c) => { setNovo(false); nav(`/clientes/${c.id}`); }} />}
      {compra && <CompraFiadoModal cliente={compra} aoFechar={() => setCompra(null)} aoConcluir={concluir} />}
      {pag && <PagamentoModal cliente={pag} aoFechar={() => setPag(null)} aoConcluir={concluir} />}
    </div>
  );
}
