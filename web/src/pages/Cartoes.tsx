import { toast } from 'sonner';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, ChevronLeft, CircleCheck, CircleX, ScanLine } from 'lucide-react';
import { get, post, put, qs } from '../api';
import { useAuth } from '../auth';
import { imprimirComprovante } from '../operacoes';
import { brl, dataBR, useCarregar, Selo, Erro, Modal, Campo, mensagemErro, lerValor, TIPOS, BotaoFechar, Tabela, Busca } from '../ui';

/** Tela de balcão: consulta saldo pelo identificador e registra compra (fluxo 8.3). */
export default function Cartoes() {
  const { pode } = useAuth();
  const [ident, setIdent] = useState('');
  const [cartao, setCartao] = useState<any>(null);
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; titulo: string; texto: string } | null>(null);
  const [uuid, setUuid] = useState(() => crypto.randomUUID());
  const [busca, setBusca] = useState('');
  const [versao, setVersao] = useState(0);
  const lista = useCarregar(() => get(`/cartoes${qs({ busca })}`), [busca, versao]);

  const consultar = async (e?: React.FormEvent) => {
    e?.preventDefault(); setErro(null); setResultado(null); setCartao(null);
    try { setCartao(await get(`/cartoes/consulta/${encodeURIComponent(ident.trim())}`)); } catch (e) { setErro(mensagemErro(e)); }
  };

  const comprar = async (e: React.FormEvent) => {
    e.preventDefault(); const v = lerValor(valor);
    if (!(v > 0)) return setErro('Informe um valor válido.');
    setErro(null);
    try {
      const r = await post('/cartoes/compras', { uuid_operacao: uuid, identificador: cartao.identificador, valor: v, descricao: descricao || null });
      setResultado({ ok: true, titulo: `Compra APROVADA · ${brl(v)}`, texto: `Saldo restante: ${brl(r.dados?.saldo_disponivel)}` });
      imprimirComprovante(r.transacao, cartao.cliente_nome, r.dados);
      setValor(''); setDescricao(''); setUuid(crypto.randomUUID()); setVersao((x) => x + 1);
      setCartao({ ...cartao, saldo: r.dados?.saldo_disponivel ?? cartao.saldo });
    } catch (e) { setResultado({ ok: false, titulo: 'Compra RECUSADA', texto: mensagemErro(e) }); }
  };

  const ativo = cartao?.status === 'ativo';
  return (
    <div className="pagina">
      <div className="topo-pagina"><div><h1>Cartões</h1><p className="subtitulo">Passe o cartão para ver o saldo e autorizar a compra.</p></div></div>
      <div className="duas-colunas">
        <section className="painel">
          <form className="filtros" onSubmit={consultar} style={{ marginBottom: 0 }}>
            <div className="busca-wrap"><ScanLine size={16} /><input autoFocus placeholder="Número do cartão" aria-label="Número do cartão" value={ident} onChange={(e) => setIdent(e.target.value)} /></div>
            <button className="btn">Consultar</button>
          </form>
          {cartao && (
            <div className={`cartao-visual ${ativo ? '' : 'inativo'}`}>
              <div className="topo"><span>{cartao.cliente_nome}</span><span>{ativo ? `Ciclo ${cartao.ciclo_atual}` : cartao.status}</span></div>
              <div className="numero">•••• {String(cartao.identificador).slice(-4)}</div>
              <div className="saldo-grande">{brl(cartao.saldo)}</div>
              <div className="rodape"><span>disponível</span><span>limite {brl(cartao.limite_recorrente)}</span></div>
            </div>)}
          {cartao && !ativo && <div className="alerta erro"><Ban size={16} />Cartão {cartao.status}: não autoriza compras.</div>}
          {cartao && ativo && pode('cartoes.comprar') && (
            <form className="form" onSubmit={comprar}>
              <Campo rotulo="Valor da compra (R$)"><span className="campo-valor"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" required style={{ width: '100%' }} /></span></Campo>
              <Campo rotulo="Descrição (opcional)"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>
              <button className="btn primario grande">Autorizar compra</button>
            </form>)}
          {resultado && (
            <div className={`resultado ${resultado.ok ? 'aprovada' : 'recusada'}`} role="status">
              {resultado.ok ? <CircleCheck size={22} /> : <CircleX size={22} />}
              <div><b>{resultado.titulo}</b><span>{resultado.texto}</span></div>
            </div>)}
          <Erro msg={erro} />
          {!cartao && !erro && <p className="sutil pequeno" style={{ marginTop: 12 }}>A compra no cartão precisa de internet para ser autorizada.</p>}
        </section>
        <section className="painel sem-padding">
          <div style={{ padding: '16px 16px 12px' }}>
            <div className="painel-topo" style={{ marginBottom: 10 }}><h2>Todos os cartões</h2></div>
            <Busca valor={busca} aoMudar={setBusca} placeholder="Cliente ou número" />
          </div>
          <table>
            <thead><tr><th>Cartão</th><th>Status</th><th className="num">Saldo</th></tr></thead>
            <tbody>{(lista.dados ?? []).map((k: any) => (
              <tr key={k.id}><td><Link to={`/cartoes/${k.id}`}><b style={{ fontWeight: 500 }}>{k.cliente_nome}</b><span className="sutil pequeno" style={{ display: 'block' }}>{k.identificador}</span></Link></td><td><Selo s={k.status} /></td><td className="num">{brl(k.saldo)}</td></tr>
            ))}{lista.dados?.length === 0 && <tr><td colSpan={3}><div className="vazio">Nenhum cartão.</div></td></tr>}</tbody>
          </table>
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
        <Erro msg={erro} /><div className="acoes"><BotaoFechar>Cancelar</BotaoFechar><button className="btn primario">Cadastrar</button></div>
      </form>
    </Modal>
  );
}

export function CartaoDetalhe() {
  const { id } = useParams();
  const { pode } = useAuth();
  const { dados: k, erro, recarregar } = useCarregar(() => get(`/cartoes/${id}`), [id]);
  const [modal, setModal] = useState<string | null>(null);
  if (erro) return <Erro msg={erro} />;
  if (!k) return null;
  const ok = (m: string) => { setModal(null); toast.success(m); recarregar(); };
  const encerrado = k.status === 'cancelado' || k.status === 'inativo';

  const virada = async () => {
    try { const r = await post(`/cartoes/${k.id}/virada`); ok(r.processada ? 'Virada processada.' : 'Nada a fazer: o ciclo atual já foi liberado.'); } catch (e) { toast.error(mensagemErro(e)); }
  };

  return (
    <div className="pagina">
      <Link to={`/clientes/${k.cliente_id}`} className="voltar"><ChevronLeft size={16} />{k.cliente_nome}</Link>
      <div className="topo-pagina"><h1>Cartão {k.identificador} <Selo s={k.status} /></h1>
        {pode('cartoes.gerenciar') && !encerrado && <div className="acoes">
          {k.status === 'ativo' ? <button className="btn" onClick={() => setModal('bloquear')}>Bloquear</button> : <button className="btn" onClick={() => setModal('desbloquear')}>Desbloquear</button>}
          <button className="btn" onClick={() => setModal('parametros')}>Limite / virada</button>
          <button className="btn" onClick={() => setModal('segunda')}>Segunda via</button>
          <button className="btn perigo" onClick={() => setModal('cancelar')}>Cancelar</button>
          {pode('cartoes.virada') && <button className="btn" onClick={virada}>Virada manual</button>}
        </div>}
      </div>
      <div className="kpis">
        <div className="kpi destaque"><span>Saldo disponível</span><strong>{brl(k.saldo)}</strong><small>ciclo {k.ciclo_atual}</small></div>
        <div className="kpi"><span>Limite recorrente</span><strong>{brl(k.limite_recorrente)}</strong><small>virada todo dia {k.dia_virada}</small></div>
      </div>
      <div className="duas-colunas">
        <section className="painel"><h2>Ciclos</h2>
          <Tabela><thead><tr><th>Competência</th><th className="num">Liberado</th><th className="num">Utilizado</th><th>Liberado em</th></tr></thead>
            <tbody>{k.ciclos.map((c: any) => <tr key={c.id}><td>{c.competencia}</td><td className="num">{brl(c.limite_liberado)}</td><td className="num">{brl(c.valor_utilizado)}</td><td>{dataBR(c.liberado_em)}</td></tr>)}</tbody></Tabela>
        </section>
        <section className="painel"><h2>Movimentações</h2>
          <Tabela><tbody>{k.transacoes.map((t: any) => (
            <tr key={t.id} className={t.status === 'estornada' ? 'riscado' : ''}><td><Link to={`/transacoes/${t.id}`}>{dataBR(t.data_hora)}</Link></td><td>{TIPOS[t.tipo]}</td><td>{t.usuario_nome}</td><td className="num">{brl(t.valor)}</td></tr>
          ))}</tbody></Tabela>
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
        <Erro msg={erro} /><div className="acoes"><BotaoFechar>Voltar</BotaoFechar><button className={`btn ${acao === 'cancelar' ? 'perigo' : 'primario'}`}>Confirmar</button></div>
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
        <Erro msg={erro} /><div className="acoes"><BotaoFechar>Voltar</BotaoFechar><button className="btn primario">Emitir</button></div>
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
        <Erro msg={erro} /><div className="acoes"><BotaoFechar>Voltar</BotaoFechar><button className="btn primario">Salvar</button></div>
      </form>
    </Modal>
  );
}
