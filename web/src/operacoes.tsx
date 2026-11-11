// Modais de operação de balcão: compra fiada, pagamento e comprovante.
import { useState } from 'react';
import { ErroApi } from './api';
import { registrarOperacao } from './offline';
import { useAuth } from './auth';
import { Modal, Campo, Erro, brl, dataBR, lerValor, mensagemErro, TIPOS, BotaoFechar } from './ui';

interface ClienteMin { id: string; nome: string; limite?: string; saldo_devedor?: string }

export function CompraFiadoModal({ cliente, aoFechar, aoConcluir }: { cliente: ClienteMin; aoFechar: () => void; aoConcluir: (msg: string) => void }) {
  const { pode } = useAuth();
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [excecao, setExcecao] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [limiteExcedido, setLimiteExcedido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [uuid] = useState(() => crypto.randomUUID());

  const disponivel = cliente.limite !== undefined ? Number(cliente.limite) - Number(cliente.saldo_devedor ?? 0) : null;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = lerValor(valor);
    if (!(v > 0)) return setErro('Informe um valor válido (ex.: 12,50).');
    setEnviando(true); setErro(null);
    try {
      const r = await registrarOperacao('compra_fiado', {
        uuid_operacao: uuid, cliente_id: cliente.id, valor: v, descricao: descricao || null,
        vencimento: vencimento || null, excecao_limite: excecao || undefined, justificativa: excecao ? justificativa : null,
      }, cliente.nome);
      aoConcluir(r.pendente
        ? `Sem conexão: compra de ${brl(v)} salva como PENDENTE. Será confirmada quando a internet voltar.`
        : `Compra de ${brl(v)} registrada para ${cliente.nome}.`);
      if (!r.pendente) imprimirComprovante(r.resultado.transacao, cliente.nome, r.resultado.dados);
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'LIMITE_EXCEDIDO') setLimiteExcedido(true);
      setErro(mensagemErro(e));
    } finally { setEnviando(false); }
  };

  return (
    <Modal titulo={`Compra fiada · ${cliente.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar} className="form">
        {disponivel !== null && <p className="muted">Limite disponível: <b>{brl(disponivel)}</b></p>}
        <Campo rotulo="Valor (R$)"><input className="valor-grande" autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" required /></Campo>
        <Campo rotulo="Descrição / itens"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: arroz, feijão" /></Campo>
        <Campo rotulo="Vencimento" dica="Em branco: prazo padrão configurado."><input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Campo>
        {limiteExcedido && pode('fiado.exceder_limite') && (
          <div className="caixa-aviso">
            <label className="check"><input type="checkbox" checked={excecao} onChange={(e) => setExcecao(e.target.checked)} /> Autorizar acima do limite</label>
            {excecao && <Campo rotulo="Justificativa (obrigatória)"><input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} required /></Campo>}
          </div>
        )}
        <Erro msg={erro} />
        <div className="acoes"><BotaoFechar>Cancelar</BotaoFechar>
          <button className="btn primario" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar compra'}</button></div>
      </form>
    </Modal>
  );
}

export function PagamentoModal({ cliente, lancamentos, aoFechar, aoConcluir }: {
  cliente: ClienteMin; lancamentos?: any[]; aoFechar: () => void; aoConcluir: (msg: string) => void;
}) {
  const abertos = (lancamentos ?? []).filter((l) => l.status === 'aberto');
  const [valor, setValor] = useState('');
  const [meio, setMeio] = useState('dinheiro');
  const [obs, setObs] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [uuid] = useState(() => crypto.randomUUID());

  const totalSel = abertos.filter((l) => selecionados.includes(l.id)).reduce((s, l) => s + Number(l.saldo_pendente), 0);
  const devido = selecionados.length ? totalSel : Number(cliente.saldo_devedor ?? 0);

  const alternar = (id: string) => setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = lerValor(valor);
    if (!(v > 0)) return setErro('Informe um valor válido.');
    setEnviando(true); setErro(null);
    try {
      const r = await registrarOperacao('pagamento_fiado', {
        uuid_operacao: uuid, cliente_id: cliente.id, valor: v, meio_pagamento: meio, observacao: obs || null,
        lancamento_ids: selecionados.length ? selecionados : undefined,
      }, cliente.nome);
      aoConcluir(r.pendente
        ? `Sem conexão: pagamento de ${brl(v)} salvo como PENDENTE.`
        : `Pagamento de ${brl(v)} registrado. Saldo devedor: ${brl(r.resultado.dados?.saldo_devedor)}.`);
      if (!r.pendente) imprimirComprovante({ ...r.resultado.transacao, meio_pagamento: meio }, cliente.nome, r.resultado.dados);
    } catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
  };

  return (
    <Modal titulo={`Pagamento · ${cliente.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar} className="form">
        <p className="muted">{selecionados.length ? 'Total dos débitos selecionados' : 'Saldo devedor'}: <b>{brl(devido)}</b>
          {' '}<button type="button" className="link" onClick={() => setValor(devido.toFixed(2).replace('.', ','))}>pagar tudo</button></p>
        {abertos.length > 0 && (
          <details>
            <summary>Escolher débitos (opcional — padrão: mais antigos primeiro)</summary>
            <ul className="lista-check">
              {abertos.map((l) => (
                <li key={l.id}><label className="check"><input type="checkbox" checked={selecionados.includes(l.id)} onChange={() => alternar(l.id)} />
                  {dataBR(l.data_hora)} · venc. {dataBR(l.vencimento)} · {l.descricao ?? 'sem descrição'} — <b>{brl(l.saldo_pendente)}</b></label></li>
              ))}
            </ul>
          </details>
        )}
        <Campo rotulo="Valor recebido (R$)"><input className="valor-grande" autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" required /></Campo>
        <Campo rotulo="Meio de recebimento">
          <select value={meio} onChange={(e) => setMeio(e.target.value)}>
            <option value="dinheiro">Dinheiro</option><option value="pix">PIX</option><option value="debito">Cartão de débito</option>
            <option value="credito">Cartão de crédito</option><option value="outro">Outro</option>
          </select>
        </Campo>
        <Campo rotulo="Observação"><input value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
        <Erro msg={erro} />
        <div className="acoes"><BotaoFechar>Cancelar</BotaoFechar>
          <button className="btn primario" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar pagamento'}</button></div>
      </form>
    </Modal>
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** RF-FIA-09 — comprovante simples para impressora térmica ou comum. */
export function imprimirComprovante(t: any, clienteNome: string, extra?: any) {
  if (localStorage.getItem('mercadinho.comprovante_auto') === 'nao') return;
  const w = window.open('', '_blank', 'width=360,height=600');
  if (!w) return;
  const linhas = [
    ['Operação', TIPOS[t.tipo] ?? t.tipo], ['Cliente', clienteNome], ['Valor', brl(t.valor)], ['Data', dataBR(t.data_hora)],
    t.descricao && ['Descrição', t.descricao], t.meio_pagamento && ['Meio', t.meio_pagamento],
    extra?.lancamento?.vencimento && ['Vencimento', dataBR(extra.lancamento.vencimento)],
    extra?.saldo_devedor && ['Saldo devedor', brl(extra.saldo_devedor)],
    extra?.saldo_disponivel && ['Saldo do cartão', brl(extra.saldo_disponivel)],
    t.justificativa && ['Justificativa', t.justificativa],
    ['Operador', t.usuario_nome ?? ''], ['Código', String(t.uuid_operacao).slice(0, 8).toUpperCase()],
  ].filter(Boolean) as string[][];
  w.document.write(`<html><head><title>Comprovante</title><style>
    body{font-family:monospace;font-size:13px;width:280px;margin:12px}h1{font-size:15px;text-align:center}
    td{padding:2px 0;vertical-align:top}td:first-child{color:#555;padding-right:8px}hr{border:0;border-top:1px dashed #000}
    </style></head><body><h1>MERCADINHO<br/>Comprovante</h1><hr/><table>${linhas.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table><hr/>
    <p style="text-align:center">Guarde este comprovante.</p><script>window.print()</script></body></html>`);
  w.document.close();
}
