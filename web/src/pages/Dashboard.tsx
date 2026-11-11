import { useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, CreditCard, HandCoins, NotebookPen, ShoppingBasket, Users, Wallet } from 'lucide-react';
import { get, qs } from '../api';
import { brl, dataBR, hoje, useCarregar, Erro, telefoneBR } from '../ui';

const fmtBRL = { style: 'currency', currency: 'BRL' } as const;
const SERIES = [
  { chave: 'fiado', nome: 'Fiado lançado', cor: 'var(--c-fiado)' },
  { chave: 'recebimentos', nome: 'Recebimentos', cor: 'var(--c-receb)' },
  { chave: 'cartao', nome: 'Uso dos cartões', cor: 'var(--c-cartao)' },
] as const;

const Dinheiro = ({ v }: { v: string | number }) => <NumberFlow value={Number(v)} locales="pt-BR" format={fmtBRL} />;
const Inteiro = ({ v }: { v: string | number }) => <NumberFlow value={Number(v)} locales="pt-BR" />;

function DicaGrafico({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-grafico">
      <b>{dataBR(String(label).slice(0, 10))}</b>
      {payload.map((p: any) => <div key={p.dataKey}><span style={{ color: p.color }}>{p.name}</span><span>{brl(p.value)}</span></div>)}
    </div>
  );
}

function Grafico({ serie }: { serie: any[] }) {
  const dados = serie.map((d) => ({ ...d, fiado: Number(d.fiado), recebimentos: Number(d.recebimentos), cartao: Number(d.cartao) }));
  const vazio = dados.every((d) => !d.fiado && !d.recebimentos && !d.cartao);
  if (vazio) return <div className="vazio">Nenhuma movimentação no período.</div>;
  return (
    <div className="grafico">
      <ResponsiveContainer width="100%" height="100%">
        {/* Gráfico funcional: sem animação de entrada, os números importam mais que o efeito. */}
        <BarChart data={dados} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="dia" tickFormatter={(d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7)} tickLine={false} axisLine={false}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }} minTickGap={16} />
          <YAxis tickFormatter={(v) => `R$ ${v}`} tickLine={false} axisLine={false} width={64} tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
          <Tooltip content={<DicaGrafico />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
          {SERIES.map((s) => <Bar key={s.chave} dataKey={s.chave} name={s.nome} fill={s.cor} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const d0 = new Date(); d0.setDate(d0.getDate() - 29);
  const [de, setDe] = useState(d0.toISOString().slice(0, 10));
  const [ate, setAte] = useState(hoje());
  const { dados: d, erro } = useCarregar(() => get(`/dashboard${qs({ de, ate })}`), [de, ate]);

  return (
    <div className="pagina">
      <div className="topo-pagina">
        <div><h1>Visão geral</h1><p className="subtitulo">Como está o fiado e os cartões do mercadinho.</p></div>
        <div className="filtros" style={{ margin: 0 }}>
          <label>De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </div>
      </div>
      <Erro msg={erro} />
      {d && (<>
        <div className="kpis">
          <div className="kpi destaque">
            <span className="kpi-rotulo"><Wallet size={14} />Fiado em aberto</span>
            <strong><Dinheiro v={d.fiado.em_aberto} /></strong>
            <small>{brl(d.fiado.vencido)} vencido · {brl(d.fiado.a_vencer)} a vencer</small>
          </div>
          <div className={`kpi ${Number(d.fiado.inadimplentes) > 0 ? 'alerta-kpi' : ''}`}>
            <span className="kpi-rotulo"><AlertTriangle size={14} />Inadimplentes</span>
            <strong><Inteiro v={d.fiado.inadimplentes} /></strong>
            <small>clientes com débito vencido</small>
          </div>
          <div className="kpi">
            <span className="kpi-rotulo"><HandCoins size={14} />Recebido hoje</span>
            <strong><Dinheiro v={d.movimento.recebido_hoje} /></strong>
            <small>{brl(d.movimento.recebido_periodo)} no período</small>
          </div>
          <div className="kpi">
            <span className="kpi-rotulo"><ShoppingBasket size={14} />Compras hoje</span>
            <strong><Inteiro v={d.movimento.compras_hoje_qtd} /></strong>
            <small>{brl(d.movimento.compras_hoje_valor)} em fiado e cartão</small>
          </div>
          <div className="kpi">
            <span className="kpi-rotulo"><Users size={14} />Clientes</span>
            <strong><Inteiro v={d.clientes.total} /></strong>
            <small>{d.clientes.ativos} ativos · {d.clientes.bloqueados} bloqueados</small>
          </div>
          <div className="kpi">
            <span className="kpi-rotulo"><CreditCard size={14} />Cartões ativos</span>
            <strong><Inteiro v={d.cartoes.ativos} /></strong>
            <small>{d.cartoes.bloqueados} bloqueados</small>
          </div>
          <div className="kpi">
            <span className="kpi-rotulo"><CreditCard size={14} />Crédito usado nos cartões</span>
            <strong><Dinheiro v={d.cartoes.credito_utilizado} /></strong>
            <small>{brl(d.cartoes.saldo_disponivel)} ainda disponível</small>
          </div>
        </div>

        <section className="painel">
          <div className="painel-topo">
            <h2>Movimento por dia</h2>
            <div className="legenda">{SERIES.map((s) => <span key={s.chave}><i style={{ background: s.cor }} />{s.nome}</span>)}</div>
          </div>
          <Grafico serie={d.serie} />
        </section>

        <div className="duas-colunas">
          <section className="painel">
            <div className="painel-topo"><h2><CalendarClock size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Vence nos próximos dias</h2><Link to="/fiados" className="link pequeno">Ver vencidos</Link></div>
            {d.alertas.vencendo.length === 0 ? <div className="vazio">Nada vencendo por agora.</div> : (
              <ul className="lista">{d.alertas.vencendo.map((a: any, i: number) => (
                <li key={i}>
                  <div className="info"><Link to={`/clientes/${a.cliente_id}`}><b>{a.nome}</b></Link><span>{telefoneBR(a.telefone)} · vence {dataBR(a.vencimento)}</span></div>
                  <span className="num">{brl(a.saldo_pendente)}</span>
                </li>))}</ul>)}
          </section>
          <section className="painel">
            <div className="painel-topo"><h2><NotebookPen size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Perto do limite</h2></div>
            {d.alertas.limite.length === 0 ? <div className="vazio">Ninguém perto do limite.</div> : (
              <ul className="lista">{d.alertas.limite.map((a: any) => {
                const pct = Math.min(Number(a.percentual), 100);
                return (
                  <li key={a.cliente_id}>
                    <div className="info">
                      <Link to={`/clientes/${a.cliente_id}`}><b>{a.nome}</b></Link>
                      <span>{brl(a.saldo_devedor)} de {brl(a.limite)}</span>
                      <div className={`medidor ${pct >= 100 ? 'perigo' : 'aviso'}`}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
                    </div>
                    <span className="num"><b>{a.percentual}%</b></span>
                  </li>);
              })}</ul>)}
          </section>
        </div>
        <p className="sutil pequeno">Atualizado em {dataBR(d.gerado_em)}. Considera só transações confirmadas, sem estornos.</p>
      </>)}
    </div>
  );
}
