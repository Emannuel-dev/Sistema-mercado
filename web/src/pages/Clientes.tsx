import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandCoins, Plus, ShoppingBasket, WifiOff } from 'lucide-react';
import { get, qs, SemConexao } from '../api';
import { useAuth } from '../auth';
import { buscarClientesOffline, db } from '../offline';
import { CompraFiadoModal, PagamentoModal } from '../operacoes';
import { brl, telefoneBR, Selo, Erro, mensagemErro, Tabela, Busca, iniciais, avisarResultado } from '../ui';
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

  const concluir = (msg: string) => { setCompra(null); setPag(null); avisarResultado(msg); setVersao((v) => v + 1); };

  return (
    <div className="pagina">
      <div className="topo-pagina">
        <div><h1>Clientes</h1><p className="subtitulo">Busque o cliente para lançar uma compra ou receber um pagamento.</p></div>
        {pode('clientes.editar') && <button className="btn primario" onClick={() => setNovo(true)}><Plus size={16} />Novo cliente</button>}
      </div>
      {offline && <div className="alerta aviso"><WifiOff size={16} />Sem conexão. Mostrando a última cópia salva neste caixa; compras e pagamentos ficam pendentes até a internet voltar.</div>}
      <div className="filtros">
        <Busca autoFocus valor={busca} aoMudar={setBusca} placeholder="Nome, telefone, CPF ou nº do cartão" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="bloqueado">Bloqueados</option></select>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação"><option value="">Qualquer situação</option><option value="com_saldo">Com saldo devedor</option><option value="inadimplente">Inadimplentes</option></select>
      </div>
      <Erro msg={erro} />
      <Tabela>
        <thead><tr><th>Cliente</th><th>Situação</th><th className="num">Devendo</th><th className="num esconder-mobile">Limite</th><th></th></tr></thead>
        <tbody>
          {itens.map((c) => (
            <tr key={c.id} className="clicavel" onClick={() => !offline && nav(`/clientes/${c.id}`)}>
              <td>
                <div className="nome-cel">
                  <span className="avatar">{iniciais(c.nome)}</span>
                  <div>{offline ? <b>{c.nome}</b> : <Link to={`/clientes/${c.id}`}><b>{c.nome}</b></Link>}<span className="sub">{telefoneBR(c.telefone)}</span></div>
                </div>
              </td>
              <td>{c.status !== 'ativo' ? <Selo s={c.status} /> : Number(c.vencido) > 0 ? <Selo s="vencido" texto="em atraso" /> : c.credito_status === 'bloqueada' ? <Selo s="bloqueado" texto="crédito bloqueado" /> : <Selo s="ativo" texto="em dia" />}</td>
              <td className="num"><span className={Number(c.saldo_devedor) > 0 ? '' : 'sutil'}>{brl(c.saldo_devedor)}</span></td>
              <td className="num sutil esconder-mobile">{brl(c.limite)}</td>
              <td className="acoes-linha" onClick={(e) => e.stopPropagation()}>
                {pode('fiado.lancar') && <button className="btn pequeno" disabled={c.status !== 'ativo'} onClick={() => setCompra(c)}><ShoppingBasket size={14} />Compra</button>}
                {pode('fiado.pagamento') && <button className="btn pequeno" disabled={Number(c.saldo_devedor) <= 0 && !offline} onClick={() => setPag(c)}><HandCoins size={14} />Pagamento</button>}
              </td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={5}><div className="vazio">{busca ? `Nenhum cliente encontrado para "${busca}".` : 'Nenhum cliente cadastrado ainda.'}</div></td></tr>}
        </tbody>
      </Tabela>
      {novo && <ClienteForm aoFechar={() => setNovo(false)} aoSalvar={(c) => { setNovo(false); nav(`/clientes/${c.id}`); }} />}
      {compra && <CompraFiadoModal cliente={compra} aoFechar={() => setCompra(null)} aoConcluir={concluir} />}
      {pag && <PagamentoModal cliente={pag} aoFechar={() => setPag(null)} aoConcluir={concluir} />}
    </div>
  );
}
