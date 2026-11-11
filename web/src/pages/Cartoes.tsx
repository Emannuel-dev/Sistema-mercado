import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put, qs } from '../api';
import { useAuth } from '../auth';
import { imprimirComprovante } from '../operacoes';
import { brl, dataBR, useCarregar, Selo, Erro, Modal, Campo, mensagemErro, lerValor, TIPOS } from '../ui';

/** Tela de balcão: consulta saldo pelo identificador e registra compra (fluxo 8.3). */
export default function Cartoes() {
  const { pode } = useAuth();
  const [ident, setIdent] = useState('');
  const [cartao, setCartao] = useState<any>(null);
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [uuid, setUuid] = useState(() => crypto.randomUUID());
  const [busca, setBusca] = useState('');
  const lista = useCarregar(() => get(`/cartoes${qs({ busca })}`), [busca, msg]);

  const consultar = async (e?: React.FormEvent) => {
    e?.preventDefault(); setErro(null); setMsg(null); setCartao(null);
    try { setCartao(await get(`/cartoes/consulta/${encodeURIComponent(ident.trim())}`)); } catch (e) { setErro(mensagemErro(e)); }
  };

  const comprar = async (e: React.FormEvent) => {
    e.preventDefault(); const v = lerValor(valor);
    if (!(v > 0)) return setErro('Informe um valor válido.');
    setErro(null);
    try {
      const r = await post('/cartoes/compras', { uuid_operacao: uuid, identificador: cartao.identificador, valor: v, descricao: descricao || null });
      setMsg(`Compra APROVADA: ${brl(v)}. Saldo restante ${brl(r.dados?.saldo_disponivel)}.`);
      imprimirComprovante(r.transacao, cartao.cliente_nome, r.dados);
      setValor(''); setDescricao(''); setUuid(crypto.randomUUID());
      setCartao({ ...cartao, saldo: r.dados?.saldo_disponivel ?? cartao.saldo });
    } catch (e) { setErro(`Compra RECUSADA: ${mensagemErro(e)}`); }
  };

  return (
    <div>
      <div className="topo-pagina"><h1>Cartões</h1></div>
      <div className="duas-colunas">
        <section className="painel">
          <h2>Compra no cartão</h2>
          <form className="filtros" onSubmit={consultar}>
            <input className="busca" autoFocus placeholder="Passe ou digite o nº do cartão" value={ident} onChange={(e) => setIdent(e.target.value)} />
            <button className="btn">Consultar</button>
          </form>
          {cartao && (
            <div className="cartao-visual">
              <div><b>{cartao.cliente_nome}</b> · {cartao.identificador} <Selo s={cartao.status} /></div>
              <div className="saldo-grande">{brl(cartao.saldo)}</div>
              <div className="muted pequeno">disponível no ciclo {cartao.ciclo_atual} · limite {brl(cartao.limite_recorrente)} · usado {brl(cartao.valor_utilizado)}</div>
              {pode('cartoes.comprar') && cartao.status === 'ativo' && (
                <form className="form" onSubmit={comprar}>
                  <Campo rotulo="Valor da compra (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
                  <Campo rotulo="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>
                  <button className="btn primario">Autorizar compra</button>
                </form>)}
              {cartao.status !== 'ativo' && <div className="alerta erro">Cartão {cartao.status}: não autoriza compras.</div>}
            </div>)}
          <Erro msg={erro} />
          {msg && <div className="alerta ok">{msg}</div>}
          <p className="muted pequeno">A compra no cartão exige conexão com o servidor.</p>
        </section>
        <section className="painel">
          <h2>Todos os cartões</h2>
          <input className="busca" placeholder="Filtrar por cliente ou número" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <table className="tabela"><thead><tr><th>Cartão</th><th>Cliente</th><th>Status</th><th className="num">Saldo</th></tr></thead>
            <tbody>{(lista.dados ?? []).map((k: any) => (
              <tr key={k.id}><td><Link to={`/cartoes/${k.id}`}>{k.identificador}</Link></td><td>{k.cliente_nome}</td><td><Selo s={k.status} /></td><td className="num">{brl(k.saldo)}</td></tr>
            ))}</tbody></table>
        </section>
      </div>
    </div>
  );
}

export function NovoCartaoModal({ clienteId, aoFechar, aoConcluir }: { clienteId: string; aoFechar: () => void; aoConcluir: () => void }) {
  const [ident, setIdent] = useState('');
  const [limite, setLimite] = useState('');
  const [dia, setDia] = useState('1');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo="Novo cartão" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); const v = lerValor(limite); if (Number.isNaN(v)) return setErro('Limite inválido.');
        try { await post('/cartoes', { cliente_id: clienteId, identificador: ident, limite_recorrente: v, dia_virada: Number(dia) }); aoConcluir(); } catch (e) { setErro(mensagemErro(e)); }
      }}>
        <Campo rotulo="Número / identificador do cartão"><input autoFocus value={ident} onChange={(e) => setIdent(e.target.value)} required /></Campo>
        <Campo rotulo="Limite recorrente (R$)"><input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="decimal" required /></Campo>
        <Campo rotulo="Dia da virada (1 a 28)" dica="Nesse dia o saldo volta para o limite (o que sobrou não acumula)."><input type="number" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} required /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario">Cadastrar</button></div>
      </form>
    </Modal>
  );
}

export function CartaoDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const { dados: k, erro, recarregar } = useCarregar(() => get(`/cartoes/${id}`), [id]);
  const [modal, setModal] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  if (erro) return <Erro msg={erro} />;
  if (!k) return <p className="muted">Carregando…</p>;
  const ok = (m: string) => { setModal(null); setAviso(m); recarregar(); };
  const encerrado = k.status === 'cancelado' || k.status === 'inativo';

  const virada = async () => {
    try { const r = await post(`/cartoes/${k.id}/virada`); ok(r.processada ? 'Virada processada.' : 'Nada a fazer: o ciclo atual já foi liberado.'); } catch (e) { setAviso(mensagemErro(e)); }
  };

  return (
    <div>
      <p><Link to={`/clientes/${k.cliente_id}`} className="link">← {k.cliente_nome}</Link></p>
      <div className="topo-pagina"><h1>Cartão {k.identificador} <Selo s={k.status} /></h1>
        {pode('cartoes.gerenciar') && !encerrado && <div className="acoes">
          {k.status === 'ativo' ? <button className="btn" onClick={() => setModal('bloquear')}>Bloquear</button> : <button className="btn" onClick={() => setModal('desbloquear')}>Desbloquear</button>}
          <button className="btn" onClick={() => setModal('parametros')}>Limite / virada</button>
          <button className="btn" onClick={() => setModal('segunda')}>Segunda via</button>
          <button className="btn perigo" onClick={() => setModal('cancelar')}>Cancelar</button>
          {pode('cartoes.virada') && <button className="btn" onClick={virada}>Virada manual</button>}
        </div>}
      </div>
      {aviso && <div className="alerta ok" onClick={() => setAviso(null)}>{aviso}</div>}
      <div className="kpis">
        <div className="kpi destaque"><span>Saldo disponível</span><strong>{brl(k.saldo)}</strong><small>ciclo {k.ciclo_atual}</small></div>
        <div className="kpi"><span>Limite recorrente</span><strong>{brl(k.limite_recorrente)}</strong><small>virada todo dia {k.dia_virada}</small></div>
      </div>
      <div className="duas-colunas">
        <section className="painel"><h2>Ciclos</h2>
          <table className="tabela"><thead><tr><th>Competência</th><th className="num">Liberado</th><th className="num">Utilizado</th><th>Liberado em</th></tr></thead>
            <tbody>{k.ciclos.map((c: any) => <tr key={c.id}><td>{c.competencia}</td><td className="num">{brl(c.limite_liberado)}</td><td className="num">{brl(c.valor_utilizado)}</td><td>{dataBR(c.liberado_em)}</td></tr>)}</tbody></table>
        </section>
        <section className="painel"><h2>Movimentações</h2>
          <table className="tabela"><tbody>{k.transacoes.map((t: any) => (
            <tr key={t.id} className={t.status === 'estornada' ? 'riscado' : ''}><td><Link to={`/transacoes/${t.id}`}>{dataBR(t.data_hora)}</Link></td><td>{TIPOS[t.tipo]}</td><td>{t.usuario_nome}</td><td className="num">{brl(t.valor)}</td></tr>
          ))}</tbody></table>
        </section>
      </div>
      {modal && ['bloquear', 'desbloquear', 'cancelar'].includes(modal) && <AcaoCartao k={k} acao={modal} aoFechar={() => setModal(null)} ok={ok} />}
      {modal === 'segunda' && <SegundaVia k={k} aoFechar={() => setModal(null)} ok={ok} />}
      {modal === 'parametros' && <Parametros k={k} aoFechar={() => setModal(null)} ok={ok} />}
    </div>
  );
}

function AcaoCartao({ k, acao, aoFechar, ok }: any) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo={`${acao[0].toUpperCase()}${acao.slice(1)} cartão`} aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post(`/cartoes/${k.id}/status`, { acao, motivo }); ok('Cartão atualizado.'); } catch (e) { setErro(mensagemErro(e)); } }}>
        {acao === 'cancelar' && <div className="alerta aviso">O cancelamento é definitivo.</div>}
        <Campo rotulo="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} required={acao === 'cancelar'} /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Voltar</button><button className={`btn ${acao === 'cancelar' ? 'perigo' : 'primario'}`}>Confirmar</button></div>
      </form>
    </Modal>
  );
}

function SegundaVia({ k, aoFechar, ok }: any) {
  const [ident, setIdent] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo="Segunda via" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await post(`/cartoes/${k.id}/segunda-via`, { novo_identificador: ident, motivo }); ok('Segunda via emitida. O cartão anterior foi inativado.'); } catch (e) { setErro(mensagemErro(e)); } }}>
        <p className="muted">O novo cartão herda saldo, ciclo e histórico. O número {k.identificador} deixa de funcionar na hora.</p>
        <Campo rotulo="Novo número"><input autoFocus value={ident} onChange={(e) => setIdent(e.target.value)} required /></Campo>
        <Campo rotulo="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="perda, roubo, defeito…" required /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Voltar</button><button className="btn primario">Emitir</button></div>
      </form>
    </Modal>
  );
}

function Parametros({ k, aoFechar, ok }: any) {
  const [limite, setLimite] = useState(String(k.limite_recorrente).replace('.', ','));
  const [dia, setDia] = useState(String(k.dia_virada));
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal titulo="Limite e dia de virada" aoFechar={aoFechar}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); const v = lerValor(limite); if (Number.isNaN(v)) return setErro('Limite inválido.');
        try { await put(`/cartoes/${k.id}`, { limite_recorrente: v, dia_virada: Number(dia) }); ok('Parâmetros salvos. O novo limite vale a partir da próxima virada.'); } catch (e) { setErro(mensagemErro(e)); }
      }}>
        <Campo rotulo="Limite recorrente (R$)"><input value={limite} onChange={(e) => setLimite(e.target.value)} /></Campo>
        <Campo rotulo="Dia de virada (1 a 28)"><input type="number" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} /></Campo>
        <Erro msg={erro} /><div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Voltar</button><button className="btn primario">Salvar</button></div>
      </form>
    </Modal>
  );
}
