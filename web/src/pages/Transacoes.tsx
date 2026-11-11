import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, qs } from '../api';
import { useAuth } from '../auth';
import { imprimirComprovante } from '../operacoes';
import { brl, dataBR, hoje, useCarregar, Erro, Modal, Campo, mensagemErro, TIPOS } from '../ui';

export default function Transacoes() {
  const [de, setDe] = useState(hoje());
  const [ate, setAte] = useState(hoje());
  const [tipo, setTipo] = useState('');
  const { dados, erro } = useCarregar(() => get(`/transacoes${qs({ de, ate, tipo, limite: 500 })}`), [de, ate, tipo]);
  return (
    <div>
      <div className="topo-pagina"><h1>Transações</h1></div>
      <div className="filtros">
        <label>De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label>Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todos os tipos</option>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <Erro msg={erro} />
      <table className="tabela"><thead><tr><th>Data</th><th>Cliente</th><th>Operação</th><th>Detalhe</th><th>Operador</th><th>Origem</th><th className="num">Valor</th></tr></thead>
        <tbody>{(dados ?? []).map((t: any) => (
          <tr key={t.id} className={t.status === 'estornada' ? 'riscado' : ''}><td><Link to={`/transacoes/${t.id}`}>{dataBR(t.data_hora)}</Link></td><td><Link to={`/clientes/${t.cliente_id}`}>{t.cliente_nome}</Link></td>
            <td>{TIPOS[t.tipo]}{t.excecao_limite && <span className="selo selo-vencido">acima do limite</span>}</td><td>{[t.descricao, t.cartao_identificador && `cartão ${t.cartao_identificador}`].filter(Boolean).join(' · ')}</td>
            <td>{t.usuario_nome}</td><td>{t.origem}</td><td className="num">{brl(t.valor)}</td></tr>
        ))}{dados?.length === 0 && <tr><td colSpan={7} className="muted centro">Nenhuma transação no período.</td></tr>}</tbody></table>
    </div>
  );
}

export function TransacaoDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const { dados: t, erro, recarregar } = useCarregar(() => get(`/transacoes/${id}`), [id]);
  const [estornar, setEstornar] = useState(false);
  if (erro) return <Erro msg={erro} />;
  if (!t) return <p className="muted">Carregando…</p>;
  const estornavel = t.status === 'confirmada' && ['compra_fiado', 'pagamento_fiado', 'compra_cartao'].includes(t.tipo);
  const linhas: [string, any][] = [
    ['Operação', TIPOS[t.tipo]], ['Status', t.status], ['Cliente', <Link to={`/clientes/${t.cliente_id}`}>{t.cliente_nome}</Link>], ['Valor', brl(t.valor)],
    ['Data/hora', dataBR(t.data_hora)], ['Operador', t.usuario_nome], ['Origem', t.origem], ['Código da operação', t.uuid_operacao],
  ];
  if (t.descricao) linhas.push(['Descrição', t.descricao]);
  if (t.meio_pagamento) linhas.push(['Meio de pagamento', t.meio_pagamento]);
  if (t.vencimento) linhas.push(['Vencimento', dataBR(t.vencimento)], ['Pendente', brl(t.saldo_pendente)]);
  if (t.cartao_identificador) linhas.push(['Cartão', t.cartao_identificador]);
  if (t.justificativa) linhas.push(['Justificativa', t.justificativa]);
  if (t.referencia_transacao_id) linhas.push(['Estorno de', <Link to={`/transacoes/${t.referencia_transacao_id}`}>ver transação original</Link>]);
  if (t.estorno_id) linhas.push(['Estornada em', <Link to={`/transacoes/${t.estorno_id}`}>{dataBR(t.estorno_data)} — {t.estorno_motivo}</Link>]);
  return (
    <div>
      <div className="topo-pagina"><h1>{TIPOS[t.tipo]} · {brl(t.valor)}</h1>
        <div className="acoes"><button className="btn" onClick={() => imprimirComprovante(t, t.cliente_nome)}>Imprimir comprovante</button>
          {pode('transacoes.estornar') && estornavel && <button className="btn perigo" onClick={() => setEstornar(true)}>Estornar</button>}</div></div>
      <section className="painel estreito"><table><tbody>{linhas.map(([a, b]) => <tr key={a}><td className="muted">{a}</td><td>{b}</td></tr>)}</tbody></table></section>
      {estornar && <EstornoModal t={t} aoFechar={() => setEstornar(false)} ok={() => { setEstornar(false); recarregar(); }} />}
    </div>
  );
}

function EstornoModal({ t, aoFechar, ok }: any) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [uuid] = useState(() => crypto.randomUUID());
  return (
    <Modal titulo="Estornar transação" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post(`/transacoes/${t.id}/estorno`, { uuid_operacao: uuid, motivo }); ok(); } catch (e) { setErro(mensagemErro(e)); } }}>
        <p>Será criado um lançamento de estorno de <b>{brl(t.valor)}</b> vinculado a esta transação. A original fica no histórico.</p>
        <Campo rotulo="Motivo (obrigatório)"><input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Voltar</button><button className="btn perigo">Confirmar estorno</button></div>
      </form>
    </Modal>
  );
}
