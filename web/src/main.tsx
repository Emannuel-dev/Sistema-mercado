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
import './styles.css';

function BarraSync() {
  const s = useEstadoSync();
  return (
    <NavLink to="/sincronizacao" className={`status-sync ${s.online ? 'on' : 'off'}`} title="Estado da sincronização">
      <i />{s.online ? 'Online' : 'Offline'}
      {s.pendentes > 0 && <b>{s.pendentes} pendente{s.pendentes > 1 ? 's' : ''}</b>}
      {s.problemas > 0 && <b className="ruim">{s.problemas} p/ revisar</b>}
    </NavLink>
  );
}

function Shell() {
  const { usuario, sair, pode } = useAuth();
  useEffect(() => iniciarSincronizacao(), []);
  const inicio = pode('dashboard.ver') ? '/dashboard' : '/clientes';
  return (
    <div className="app">
      <aside className="menu">
        <div className="marca">Mercadinho</div>
        <nav>
          {pode('dashboard.ver') && <NavLink to="/dashboard">Dashboard</NavLink>}
          <NavLink to="/clientes">Clientes</NavLink>
          <NavLink to="/fiados">Fiados</NavLink>
          {pode('cartoes.ver') && <NavLink to="/cartoes">Cartões</NavLink>}
          {pode('transacoes.ver') && <NavLink to="/transacoes">Transações</NavLink>}
          {pode('usuarios.gerenciar') && <NavLink to="/usuarios">Usuários</NavLink>}
          <NavLink to="/sincronizacao">Sincronização</NavLink>
          <NavLink to="/configuracoes">Configurações</NavLink>
        </nav>
        <div className="rodape-menu">
          <BarraSync />
          <div className="usuario"><b>{usuario?.nome}</b><span>{usuario?.perfil}</span></div>
          <NavLink to="/senha" className="link pequeno">Trocar senha</NavLink>
          <button className="btn pequeno" onClick={sair}>Sair</button>
        </div>
      </aside>
      <main className="conteudo">
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
  if (carregando) return <p className="muted centro">Carregando…</p>;
  if (!usuario) return <Login />;
  if (usuario.trocar_senha) return <TrocarSenha obrigatoria />;
  return <Shell />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>,
);
