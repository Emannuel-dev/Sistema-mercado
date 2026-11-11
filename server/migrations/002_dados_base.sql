-- Perfis, permissões, usuário de sistema e configurações padrão.

INSERT INTO perfis (nome) VALUES ('administrador'), ('gerente'), ('operador');

INSERT INTO permissoes (codigo, descricao) VALUES
  ('clientes.ver',            'Consultar clientes'),
  ('clientes.editar',         'Cadastrar e editar clientes'),
  ('clientes.status',         'Ativar, inativar ou bloquear clientes'),
  ('fiado.lancar',            'Registrar compra fiada'),
  ('fiado.pagamento',         'Registrar pagamento de fiado'),
  ('fiado.exceder_limite',    'Autorizar compra fiada acima do limite'),
  ('fiado.limite',            'Alterar limite e bloquear crédito de fiado'),
  ('cartoes.ver',             'Consultar cartões'),
  ('cartoes.comprar',         'Registrar compra no cartão'),
  ('cartoes.gerenciar',       'Cadastrar, bloquear, cancelar e emitir segunda via de cartões'),
  ('cartoes.virada',          'Executar virada manual de cartões'),
  ('transacoes.ver',          'Consultar transações'),
  ('transacoes.estornar',     'Estornar transações'),
  ('dashboard.ver',           'Ver dashboard e relatórios'),
  ('usuarios.gerenciar',      'Gerenciar usuários'),
  ('configuracoes.gerenciar', 'Alterar configurações'),
  ('auditoria.ver',           'Consultar auditoria');

-- Administrador: tudo
INSERT INTO perfis_permissoes (perfil_id, permissao_id)
SELECT p.id, pe.id FROM perfis p CROSS JOIN permissoes pe WHERE p.nome = 'administrador';

-- Gerente: tudo menos usuários e configurações
INSERT INTO perfis_permissoes (perfil_id, permissao_id)
SELECT p.id, pe.id FROM perfis p CROSS JOIN permissoes pe
WHERE p.nome = 'gerente' AND pe.codigo NOT IN ('usuarios.gerenciar', 'configuracoes.gerenciar');

-- Operador: operação de balcão
INSERT INTO perfis_permissoes (perfil_id, permissao_id)
SELECT p.id, pe.id FROM perfis p CROSS JOIN permissoes pe
WHERE p.nome = 'operador' AND pe.codigo IN
  ('clientes.ver','clientes.editar','fiado.lancar','fiado.pagamento','cartoes.ver','cartoes.comprar','transacoes.ver');

-- Usuário técnico usado nas rotinas automáticas (virada). Não consegue fazer login.
INSERT INTO usuarios (id, nome, login, senha_hash, perfil_id, ativo)
SELECT '00000000-0000-0000-0000-000000000001', 'Sistema', 'sistema', '!', id, FALSE
FROM perfis WHERE nome = 'administrador';

INSERT INTO configuracoes (chave, valor) VALUES
  ('prazo_vencimento_dias', '30'),
  ('limite_fiado_padrao', '200.00'),
  ('alerta_limite_percentual', '80'),
  ('alerta_vencimento_dias', '3'),
  ('sessao_minutos', '30');
