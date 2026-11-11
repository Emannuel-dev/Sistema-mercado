import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { iniciarSincronizacao, useEstadoSync } from './offline';
import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import ClienteDetalhe from './pages/ClienteDetalhe';
import Fiados from './pages/Fiados';
import Cartoes, { CartaoDetalhe } from './pages/Cartoes';
import Transacoes, { TransacaoDetalhe } from './pages/Transacoes';
import { Usuarios, Sincronizacao, Configuracoes } from './pages/Admin';
import { Toaster } from 'sonner';
import { ArrowLeftRight, CreditCard, LayoutDashboard, LogOut, NotebookPen, RefreshCw, Settings, Store, UserCog, Users } from 'lucide-react';
import { iniciais } from './ui';
import '@fontsource-variable/inter';
import './styles.css';

function BarraSync() {
  const s = useEstadoSync();
  return (
    <NavLink to="/sincronizacao" className={`status-sync ${s.online ? 'on' : 'off'}`} title="Estado da sincronização">
      <span className="ponto" /><span className="rotulo">{s.online ? 'Online' : 'Sem conexão'}</span>
      {s.pendentes > 0 && <span className="contador">{s.pendentes} pendente{s.pendentes > 1 ? 's' : ''}</span>}
      {s.problemas > 0 && <span className="contador ruim">{s.problemas} p/ revisar</span>}
    </NavLink>
  );
}

const ICONE = 17;

function Shell() {
  const { usuario, sair, pode } = useAuth();
  useEffect(() => iniciarSincronizacao(), []);
  const inicio = pode('dashboard.ver') ? '/dashboard' : '/clientes';
  return (
    <div className="app">
      <a href="#conteudo" className="pular">Pular para o conteúdo</a>
      <aside className="menu">
        <div className="marca"><span className="marca-icone"><Store size={16} /></span><div>Mercadinho<small>Fiados e cartões</small></div></div>
        <nav aria-label="Principal">
          {pode('dashboard.ver') && <NavLink to="/dashboard"><LayoutDashboard size={ICONE} /><span>Visão geral</span></NavLink>}
          <NavLink to="/clientes"><Users size={ICONE} /><span>Clientes</span></NavLink>
          <NavLink to="/fiados"><NotebookPen size={ICONE} /><span>Fiados</span></NavLink>
          {pode('cartoes.ver') && <NavLink to="/cartoes"><CreditCard size={ICONE} /><span>Cartões</span></NavLink>}
          {pode('transacoes.ver') && <NavLink to="/transacoes"><ArrowLeftRight size={ICONE} /><span>Transações</span></NavLink>}
          <div className="menu-secao">Sistema</div>
          {pode('usuarios.gerenciar') && <NavLink to="/usuarios"><UserCog size={ICONE} /><span>Usuários</span></NavLink>}
          <NavLink to="/sincronizacao"><RefreshCw size={ICONE} /><span>Sincronização</span></NavLink>
          <NavLink to="/configuracoes"><Settings size={ICONE} /><span>Configurações</span></NavLink>
        </nav>
        <div className="rodape-menu">
          <BarraSync />
          <div className="perfil">
            <NavLink to="/senha" className="avatar" title="Trocar senha">{iniciais(usuario?.nome)}</NavLink>
            <div className="perfil-info"><b>{usuario?.nome}</b><span>{usuario?.perfil}</span></div>
            <button className="btn-icone" onClick={sair} aria-label="Sair" title="Sair"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="conteudo" id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to={inicio} replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:id" element={<ClienteDetalhe />} />
          <Route path="/fiados" element={<Fiados />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="/cartoes/:id" element={<CartaoDetalhe />} />
          <Route path="/transacoes" element={<Transacoes />} />
          <Route path="/transacoes/:id" element={<TransacaoDetalhe />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/sincronizacao" element={<Sincronizacao />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/senha" element={<TrocarSenha />} />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const { usuario, carregando } = useAuth();
  if (carregando) return null;
  if (!usuario) return <Login />;
  if (usuario.trocar_senha) return <TrocarSenha obrigatoria />;
  return <Shell />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthProvider><App /><Toaster position="bottom-right" richColors closeButton duration={4000} /></AuthProvider></BrowserRouter></StrictMode>,
);
