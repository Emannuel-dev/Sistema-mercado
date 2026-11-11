import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { CompraFiadoModal, PagamentoModal } from '../operacoes';
import { brl, dataBR, telefoneBR, useCarregar, Selo, Erro, Modal, Campo, mensagemErro, lerValor, TIPOS } from '../ui';
import { ClienteForm } from './ClienteForm';
import { NovoCartaoModal } from './Cartoes';

export default function ClienteDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const { dados: c, erro, recarregar } = useCarregar(() => get(`/clientes/${id}`), [id]);
  const [modal, setModal] = useState<'compra' | 'pagamento' | 'editar' | 'status' | 'credito' | 'cartao' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<'debitos' | 'historico' | 'cartoes'>('debitos');

  if (erro) return <Erro msg={erro} />;
  if (!c) return <p className="muted">Carregando…</p>;
  const concluir = (msg: string) => { setModal(null); setAviso(msg); recarregar(); };
  const disponivel = Number(c.limite) - Number(c.saldo_devedor);

  return (
    <div>
      <p><Link to="/clientes" className="link">← Clientes</Link></p>
      <div className="topo-pagina">
        <div><h1>{c.nome} <Selo s={c.status} /> {c.credito_status === 'bloqueada' && <span className="selo selo-bloqueado">crédito bloqueado</span>}</h1>
          <p className="muted">{telefoneBR(c.telefone)}{c.cpf && ` · CPF ${c.cpf}`}{c.bairro && ` · ${c.bairro}`}</p></div>
        <div className="acoes">
          {pode('fiado.lancar') && <button className="btn primario" disabled={c.status !== 'ativo'} onClick={() => setModal('compra')}>Nova compra fiada</button>}
          {pode('fiado.pagamento') && <button className="btn primario" disabled={Number(c.saldo_devedor) <= 0} onClick={() => setModal('pagamento')}>Receber pagamento</button>}
        </div>
      </div>
      {aviso && <div className="alerta ok" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="kpis">
        <div className="kpi destaque"><span>Total devido</span><strong>{brl(c.fiado.total)}</strong><small>Limite {brl(c.limite)} · disponível {brl(disponivel)}</small></div>
        <div className={`kpi ${Number(c.fiado.vencido) > 0 ? 'alerta-kpi' : ''}`}><span>Vencido</span><strong>{brl(c.fiado.vencido)}</strong><small>{c.fiado.dias_atraso > 0 ? `${c.fiado.dias_atraso} dias de atraso` : 'em dia'}</small></div>
        <div className="kpi"><span>A vencer</span><strong>{brl(c.fiado.a_vencer)}</strong></div>
        <div className="kpi"><span>Cartões ativos</span><strong>{c.cartoes.filter((k: any) => k.status === 'ativo').length}</strong></div>
      </div>

      <div className="abas">
        <button className={aba === 'debitos' ? 'ativa' : ''} onClick={() => setAba('debitos')}>Débitos</button>
        <button className={aba === 'historico' ? 'ativa' : ''} onClick={() => setAba('historico')}>Histórico</button>
        <button className={aba === 'cartoes' ? 'ativa' : ''} onClick={() => setAba('cartoes')}>Cartões ({c.cartoes.length})</button>
        <span className="espaco" />
        {pode('clientes.editar') && <button className="btn pequeno" onClick={() => setModal('editar')}>Editar dados</button>}
        {pode('clientes.status') && <button className="btn pequeno" onClick={() => setModal('status')}>Status</button>}
        {pode('fiado.limite') && <button className="btn pequeno" onClick={() => setModal('credito')}>Limite / crédito</button>}
      </div>

      {aba === 'debitos' && (
        <table className="tabela"><thead><tr><th>Compra</th><th>Descrição</th><th>Vencimento</th><th>Situação</th><th className="num">Original</th><th className="num">Pendente</th></tr></thead>
          <tbody>{c.lancamentos.map((l: any) => (
            <tr key={l.id} className={l.vencido ? 'linha-vencida' : ''}><td>{dataBR(l.data_hora)}</td><td>{l.descricao ?? '—'}</td><td>{dataBR(l.vencimento)}</td>
              <td>{l.vencido ? <span className="selo selo-vencido">{l.dias_atraso} dias em atraso</span> : <Selo s={l.status} />}</td>
              <td className="num">{brl(l.valor_original)}</td><td className="num"><b>{brl(l.saldo_pendente)}</b></td></tr>
          ))}{c.lancamentos.length === 0 && <tr><td colSpan={6} className="muted centro">Nenhuma compra fiada.</td></tr>}</tbody></table>
      )}

      {aba === 'historico' && (
        <table className="tabela"><thead><tr><th>Data</th><th>Operação</th><th>Detalhe</th><th>Operador</th><th>Origem</th><th className="num">Valor</th></tr></thead>
          <tbody>{c.transacoes.map((t: any) => (
            <tr key={t.id} className={t.status === 'estornada' ? 'riscado' : ''}><td><Link to={`/transacoes/${t.id}`}>{dataBR(t.data_hora)}</Link></td><td>{TIPOS[t.tipo]}{t.status === 'estornada' && <span className="selo selo-estornado">estornada</span>}</td>
              <td>{[t.descricao, t.meio_pagamento && `(${t.meio_pagamento})`, t.cartao_identificador && `cartão ${t.cartao_identificador}`].filter(Boolean).join(' · ')}</td>
              <td>{t.usuario_nome}</td><td>{t.origem}</td><td className={`num ${t.tipo === 'pagamento_fiado' || t.tipo === 'estorno' ? 'positivo' : ''}`}>{brl(t.valor)}</td></tr>
          ))}</tbody></table>
      )}

      {aba === 'cartoes' && (<>
        {pode('cartoes.gerenciar') && <p><button className="btn" onClick={() => setModal('cartao')}>+ Novo cartão</button></p>}
        <table className="tabela"><thead><tr><th>Identificador</th><th>Status</th><th className="num">Saldo</th><th className="num">Limite</th><th>Virada</th></tr></thead>
          <tbody>{c.cartoes.map((k: any) => (
            <tr key={k.id}><td><Link to={`/cartoes/${k.id}`}>{k.identificador}</Link></td><td><Selo s={k.status} /></td><td className="num">{brl(k.saldo)}</td><td className="num">{brl(k.limite_recorrente)}</td><td>dia {k.dia_virada}</td></tr>
          ))}</tbody></table>
      </>)}

      {c.observacoes && <section className="painel"><h2>Observações</h2><p>{c.observacoes}</p></section>}

      {modal === 'compra' && <CompraFiadoModal cliente={c} aoFechar={() => setModal(null)} aoConcluir={concluir} />}
      {modal === 'pagamento' && <PagamentoModal cliente={c} lancamentos={c.lancamentos} aoFechar={() => setModal(null)} aoConcluir={concluir} />}
      {modal === 'editar' && <ClienteForm cliente={c} aoFechar={() => setModal(null)} aoSalvar={() => concluir('Dados atualizados.')} />}
      {modal === 'status' && <StatusModal c={c} aoFechar={() => setModal(null)} aoConcluir={concluir} />}
      {modal === 'credito' && <CreditoModal c={c} aoFechar={() => setModal(null)} aoConcluir={concluir} />}
      {modal === 'cartao' && <NovoCartaoModal clienteId={c.id} aoFechar={() => setModal(null)} aoConcluir={() => concluir('Cartão cadastrado.')} />}
    </div>
  );
}

function StatusModal({ c, aoFechar, aoConcluir }: any) {
  const [status, setStatus] = useState(c.status);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo="Alterar status do cliente" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post(`/clientes/${c.id}/status`, { status, motivo }); aoConcluir('Status alterado.'); } catch (e) { setErro(mensagemErro(e)); } }}>
        <Campo rotulo="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="bloqueado">Bloqueado</option></select></Campo>
        <Campo rotulo="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></Campo>
        <p className="muted pequeno">O histórico do cliente é mantido.</p>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario">Salvar</button></div>
      </form>
    </Modal>
  );
}

function CreditoModal({ c, aoFechar, aoConcluir }: any) {
  const [limite, setLimite] = useState(String(c.limite).replace('.', ','));
  const [status, setStatus] = useState(c.credito_status);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo="Limite e crédito de fiado" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); const v = lerValor(limite); if (Number.isNaN(v)) return setErro('Limite inválido.');
        try { await post(`/clientes/${c.id}/credito`, { limite: v, status, motivo }); aoConcluir('Crédito atualizado.'); } catch (e) { setErro(mensagemErro(e)); }
      }}>
        <Campo rotulo="Limite (R$)"><input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="decimal" /></Campo>
        <Campo rotulo="Crédito"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ativa">Liberado</option><option value="bloqueada">Bloqueado</option></select></Campo>
        <Campo rotulo="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario">Salvar</button></div>
      </form>
    </Modal>
  );
}
