import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../api';
import { brl, dataBR, telefoneBR, useCarregar, Erro, Tabela } from '../ui';

export default function Fiados() {
  const [situacao, setSituacao] = useState('vencido');
  const { dados, erro } = useCarregar(() => get(`/fiado/lancamentos${qs({ situacao })}`), [situacao]);
  const total = (dados ?? []).reduce((s: number, l: any) => s + Number(l.saldo_pendente), 0);
  return (
    <div className="pagina">
      <div className="topo-pagina"><div><h1>Fiados</h1><p className="subtitulo">Débitos por situação de vencimento.</p></div>
        <div className="segmentos">{[['vencido', 'Vencidos'], ['a_vencer', 'A vencer'], ['aberto', 'Todos em aberto'], ['quitado', 'Quitados']].map(([v, r]) => (
          <button key={v} className={situacao === v ? 'ativa' : ''} onClick={() => setSituacao(v)}>{r}</button>))}</div></div>
      <Erro msg={erro} />
      <p className="muted" style={{ marginBottom: 12 }}>{dados?.length ?? 0} débitos · <b className="tab">{brl(total)}</b> pendente</p>
      <Tabela><thead><tr><th>Cliente</th><th>Telefone</th><th>Compra</th><th>Descrição</th><th>Vencimento</th><th>Atraso</th><th className="num">Pendente</th></tr></thead>
        <tbody>{(dados ?? []).map((l: any) => (
          <tr key={l.id} className={l.dias_atraso > 0 && l.status === 'aberto' ? 'linha-vencida' : ''}><td><Link to={`/clientes/${l.cliente_id}`}>{l.cliente_nome}</Link></td><td>{telefoneBR(l.telefone)}</td>
            <td>{dataBR(l.data_hora)}</td><td>{l.descricao ?? '—'}</td><td>{dataBR(l.vencimento)}</td><td>{l.status === 'aberto' && l.dias_atraso > 0 ? `${l.dias_atraso} dias` : '—'}</td>
            <td className="num"><b>{brl(l.saldo_pendente)}</b></td></tr>
        ))}</tbody></Tabela>
    </div>
  );
}
