import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../api';
import { brl, dataBR, hoje, useCarregar, Erro, telefoneBR } from '../ui';

function Grafico({ serie }: { serie: any[] }) {
  const max = Math.max(1, ...serie.flatMap((d) => [Number(d.fiado), Number(d.recebimentos), Number(d.cartao)]));
  const largura = Math.max(serie.length * 18, 300);
  const cores = { fiado: 'var(--c-fiado)', recebimentos: 'var(--c-receb)', cartao: 'var(--c-cartao)' } as const;
  return (
    <div className="grafico">
      <svg viewBox={`0 0 ${largura} 140`} preserveAspectRatio="none" role="img" aria-label="Evolução diária de fiados, recebimentos e cartões">
        {serie.map((d, i) => (['fiado', 'recebimentos', 'cartao'] as const).map((k, j) => {
          const h = (Number(d[k]) / max) * 120;
          return <rect key={`${i}${k}`} x={i * 18 + j * 5 + 1} y={130 - h} width={4.5} height={h} fill={cores[k]}><title>{`${dataBR(d.dia.slice(0, 10))} · ${k}: ${brl(d[k])}`}</title></rect>;
        }))}
      </svg>
      <div className="legenda"><span><i style={{ background: cores.fiado }} />Fiado lançado</span><span><i style={{ background: cores.recebimentos }} />Recebimentos</span><span><i style={{ background: cores.cartao }} />Uso dos cartões</span></div>
    </div>
  );
}

export default function Dashboard() {
  const d0 = new Date(); d0.setDate(d0.getDate() - 29);
  const [de, setDe] = useState(d0.toISOString().slice(0, 10));
  const [ate, setAte] = useState(hoje());
  const { dados: d, erro } = useCarregar(() => get(`/dashboard${qs({ de, ate })}`), [de, ate]);

  return (
    <div>
      <div className="topo-pagina"><h1>Dashboard</h1>
        <div className="filtros"><label>De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label></div></div>
      <Erro msg={erro} />
      {d && (<>
        <div className="kpis">
          <Kpi titulo="Fiado em aberto" valor={brl(d.fiado.em_aberto)} sub={`Vencido ${brl(d.fiado.vencido)} · a vencer ${brl(d.fiado.a_vencer)}`} destaque />
          <Kpi titulo="Clientes inadimplentes" valor={d.fiado.inadimplentes} sub="com débito vencido" alerta={Number(d.fiado.inadimplentes) > 0} />
          <Kpi titulo="Recebido hoje" valor={brl(d.movimento.recebido_hoje)} sub={`No período: ${brl(d.movimento.recebido_periodo)}`} />
          <Kpi titulo="Compras hoje" valor={d.movimento.compras_hoje_qtd} sub={brl(d.movimento.compras_hoje_valor)} />
          <Kpi titulo="Clientes" valor={d.clientes.total} sub={`${d.clientes.ativos} ativos · ${d.clientes.bloqueados} bloqueados`} />
          <Kpi titulo="Cartões" valor={d.cartoes.ativos} sub={`ativos · ${d.cartoes.bloqueados} bloqueados`} />
          <Kpi titulo="Crédito utilizado (cartões)" valor={brl(d.cartoes.credito_utilizado)} sub={`Disponível: ${brl(d.cartoes.saldo_disponivel)}`} />
        </div>
        <section className="painel"><h2>Evolução no período</h2><Grafico serie={d.serie} /></section>
        <div className="duas-colunas">
          <section className="painel"><h2>Vencendo nos próximos dias</h2>
            {d.alertas.vencendo.length === 0 ? <p className="muted">Nada vencendo.</p> : (
              <table><tbody>{d.alertas.vencendo.map((a: any, i: number) => (
                <tr key={i}><td><Link to={`/clientes/${a.cliente_id}`}>{a.nome}</Link><div className="muted pequeno">{telefoneBR(a.telefone)}</div></td><td>{dataBR(a.vencimento)}</td><td className="num">{brl(a.saldo_pendente)}</td></tr>
              ))}</tbody></table>)}
            <Link to="/fiados" className="link">Ver todos os vencidos →</Link>
          </section>
          <section className="painel"><h2>Perto do limite</h2>
            {d.alertas.limite.length === 0 ? <p className="muted">Nenhum cliente perto do limite.</p> : (
              <table><tbody>{d.alertas.limite.map((a: any) => (
                <tr key={a.cliente_id}><td><Link to={`/clientes/${a.cliente_id}`}>{a.nome}</Link></td><td className="num">{brl(a.saldo_devedor)} / {brl(a.limite)}</td><td className="num"><b>{a.percentual}%</b></td></tr>
              ))}</tbody></table>)}
          </section>
        </div>
        <p className="muted pequeno">Gerado em {dataBR(d.gerado_em)}. Valores consideram apenas transações confirmadas (estornos excluídos).</p>
      </>)}
    </div>
  );
}

const Kpi = ({ titulo, valor, sub, destaque, alerta }: { titulo: string; valor: any; sub?: string; destaque?: boolean; alerta?: boolean }) => (
  <div className={`kpi ${destaque ? 'destaque' : ''} ${alerta ? 'alerta-kpi' : ''}`}><span>{titulo}</span><strong>{valor}</strong>{sub && <small>{sub}</small>}</div>
);
