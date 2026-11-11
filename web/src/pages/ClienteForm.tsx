import { useState } from 'react';
import { post, put, ErroApi } from '../api';
import { Modal, Campo, Erro, mensagemErro, lerValor } from '../ui';

const CAMPOS = ['nome', 'telefone', 'cpf', 'data_nascimento', 'endereco', 'bairro', 'complemento', 'referencia', 'observacoes'] as const;

export function ClienteForm({ cliente, aoFechar, aoSalvar }: { cliente?: any; aoFechar: () => void; aoSalvar: (c: any) => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS.map((k) => [k, cliente?.[k] ?? ''])));
  const [limite, setLimite] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<any[] | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const salvar = async (confirmar = false) => {
    setErro(null);
    try {
      const corpo: any = { ...f };
      if (!cliente) {
        if (limite.trim()) { const v = lerValor(limite); if (Number.isNaN(v)) return setErro('Limite inválido.'); corpo.limite_fiado = v; }
        if (confirmar) corpo.confirmar_duplicidade = true;
      }
      aoSalvar(cliente ? await put(`/clientes/${cliente.id}`, corpo) : await post('/clientes', corpo));
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'POSSIVEL_DUPLICIDADE') setDuplicados(e.detalhes);
      else setErro(mensagemErro(e));
    }
  };

  return (
    <Modal titulo={cliente ? 'Editar cliente' : 'Novo cliente'} aoFechar={aoFechar}>
      <form className="form grade" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        <Campo rotulo="Nome *"><input autoFocus value={f.nome} onChange={set('nome')} required /></Campo>
        <Campo rotulo="Telefone (com DDD) *"><input value={f.telefone} onChange={set('telefone')} inputMode="tel" required /></Campo>
        <Campo rotulo="CPF (opcional)"><input value={f.cpf} onChange={set('cpf')} inputMode="numeric" /></Campo>
        <Campo rotulo="Data de nascimento (opcional)"><input type="date" value={f.data_nascimento} onChange={set('data_nascimento')} /></Campo>
        <Campo rotulo="Endereço"><input value={f.endereco} onChange={set('endereco')} /></Campo>
        <Campo rotulo="Bairro"><input value={f.bairro} onChange={set('bairro')} /></Campo>
        <Campo rotulo="Complemento"><input value={f.complemento} onChange={set('complemento')} /></Campo>
        <Campo rotulo="Ponto de referência"><input value={f.referencia} onChange={set('referencia')} /></Campo>
        {!cliente && <Campo rotulo="Limite de fiado (R$)" dica="Em branco: limite padrão."><input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="decimal" /></Campo>}
        <Campo rotulo="Observações"><textarea value={f.observacoes} onChange={set('observacoes')} rows={2} /></Campo>
        <div className="largo">
          <Erro msg={erro} />
          {duplicados && (
            <div className="alerta aviso">Já existe cliente com este telefone: <b>{duplicados.map((d) => d.nome).join(', ')}</b>.
              <div className="acoes"><button type="button" className="btn" onClick={() => salvar(true)}>É outra pessoa, cadastrar mesmo assim</button></div></div>
          )}
          <div className="acoes"><button type="button" className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario">Salvar</button></div>
        </div>
      </form>
    </Modal>
  );
}
