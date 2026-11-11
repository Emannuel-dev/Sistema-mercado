-- Esquema inicial do Sistema de Controle de Clientes, Fiados e Cartões (MVP 1.1)
-- Valores monetários sempre em NUMERIC(12,2). Saldos são derivados das transações
-- e só são alterados dentro de transações SQL que também gravam a movimentação.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Perfis e permissões -------------------------------------------------------
CREATE TABLE perfis (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL UNIQUE
);

CREATE TABLE permissoes (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE,
  descricao   TEXT NOT NULL
);

CREATE TABLE perfis_permissoes (
  perfil_id    INT NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permissao_id INT NOT NULL REFERENCES permissoes(id) ON DELETE CASCADE,
  PRIMARY KEY (perfil_id, permissao_id)
);

-- Usuários -------------------------------------------------------------------
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  perfil_id     INT NOT NULL REFERENCES perfis(id),
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  trocar_senha  BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso TIMESTAMPTZ
);

-- Dispositivos -----------------------------------------------------------------
CREATE TABLE dispositivos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  ultimo_sync   TIMESTAMPTZ,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Clientes ---------------------------------------------------------------------
CREATE TABLE clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL CHECK (length(trim(nome)) > 0),
  telefone        TEXT NOT NULL,
  cpf             TEXT,
  data_nascimento DATE,
  endereco        TEXT,
  bairro          TEXT,
  complemento     TEXT,
  referencia      TEXT,
  observacoes     TEXT,
  status          TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','bloqueado')),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clientes_cpf_uk ON clientes (cpf) WHERE cpf IS NOT NULL;
CREATE INDEX clientes_nome_idx ON clientes (lower(nome));
CREATE INDEX clientes_telefone_idx ON clientes (telefone);
CREATE INDEX clientes_status_idx ON clientes (status);

-- Contas de fiado (uma por cliente) ---------------------------------------------
CREATE TABLE contas_fiado (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL UNIQUE REFERENCES clientes(id),
  limite         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (limite >= 0),
  saldo_devedor  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saldo_devedor >= 0),
  status         TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','bloqueada')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cartões próprios ---------------------------------------------------------------
CREATE TABLE cartoes_cliente (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         UUID NOT NULL REFERENCES clientes(id),
  identificador      TEXT NOT NULL UNIQUE,
  limite_recorrente  NUMERIC(12,2) NOT NULL CHECK (limite_recorrente >= 0),
  dia_virada         SMALLINT NOT NULL CHECK (dia_virada BETWEEN 1 AND 28),
  saldo              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  status             TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','bloqueado','cancelado','inativo')),
  ciclo_atual        CHAR(7) NOT NULL,              -- competência AAAA-MM
  substitui_cartao_id UUID REFERENCES cartoes_cliente(id),
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cartoes_cliente_idx ON cartoes_cliente (cliente_id);
CREATE INDEX cartoes_status_idx ON cartoes_cliente (status);

-- Transações: livro imutável de movimentações ----------------------------------------
CREATE TABLE transacoes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_operacao           UUID NOT NULL UNIQUE,
  cliente_id              UUID NOT NULL REFERENCES clientes(id),
  cartao_id               UUID REFERENCES cartoes_cliente(id),
  tipo                    TEXT NOT NULL CHECK (tipo IN ('compra_fiado','pagamento_fiado','compra_cartao','virada_cartao','estorno')),
  valor                   NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  descricao               TEXT,
  data_hora               TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id              UUID NOT NULL REFERENCES usuarios(id),
  dispositivo_id          UUID REFERENCES dispositivos(id),
  origem                  TEXT NOT NULL DEFAULT 'online' CHECK (origem IN ('online','offline','sistema')),
  status                  TEXT NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada','estornada')),
  referencia_transacao_id UUID REFERENCES transacoes(id),
  justificativa           TEXT,
  excecao_limite          BOOLEAN NOT NULL DEFAULT FALSE,
  competencia             CHAR(7)              -- ciclo do cartão em que a compra ocorreu
);
CREATE INDEX transacoes_cliente_idx ON transacoes (cliente_id, data_hora DESC);
CREATE INDEX transacoes_data_idx ON transacoes (data_hora);
CREATE INDEX transacoes_tipo_idx ON transacoes (tipo);
CREATE UNIQUE INDEX transacoes_estorno_unico ON transacoes (referencia_transacao_id) WHERE tipo = 'estorno';

-- Lançamentos individuais de fiado ------------------------------------------------------
CREATE TABLE lancamentos_fiado (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id        UUID NOT NULL REFERENCES contas_fiado(id),
  transacao_id    UUID NOT NULL UNIQUE REFERENCES transacoes(id),
  valor_original  NUMERIC(12,2) NOT NULL CHECK (valor_original > 0),
  saldo_pendente  NUMERIC(12,2) NOT NULL CHECK (saldo_pendente >= 0),
  vencimento      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','quitado','estornado')),
  CHECK (saldo_pendente <= valor_original)
);
CREATE INDEX lancamentos_conta_idx ON lancamentos_fiado (conta_id, status);
CREATE INDEX lancamentos_vencimento_idx ON lancamentos_fiado (vencimento) WHERE status = 'aberto';

-- Pagamentos e sua alocação nos lançamentos ---------------------------------------------
CREATE TABLE pagamentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transacao_id    UUID NOT NULL UNIQUE REFERENCES transacoes(id),
  meio_pagamento  TEXT NOT NULL CHECK (meio_pagamento IN ('dinheiro','pix','debito','credito','outro')),
  valor_recebido  NUMERIC(12,2) NOT NULL CHECK (valor_recebido > 0),
  observacao      TEXT
);

CREATE TABLE pagamentos_alocacoes (
  pagamento_id   UUID NOT NULL REFERENCES pagamentos(id),
  lancamento_id  UUID NOT NULL REFERENCES lancamentos_fiado(id),
  valor          NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  PRIMARY KEY (pagamento_id, lancamento_id)
);

-- Ciclos de cartão (virada idempotente) ----------------------------------------------------
CREATE TABLE ciclos_cartao (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cartao_id        UUID NOT NULL REFERENCES cartoes_cliente(id),
  competencia      CHAR(7) NOT NULL,
  limite_liberado  NUMERIC(12,2) NOT NULL CHECK (limite_liberado >= 0),
  valor_utilizado  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_utilizado >= 0),
  liberado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  transacao_id     UUID REFERENCES transacoes(id),
  UNIQUE (cartao_id, competencia)
);

-- Fila de sincronização (registro no servidor do que chegou dos dispositivos) -------------
CREATE TABLE fila_sincronizacao (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_operacao   UUID NOT NULL UNIQUE,
  dispositivo_id  UUID REFERENCES dispositivos(id),
  usuario_id      UUID REFERENCES usuarios(id),
  tipo            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('sincronizada','rejeitada','requer_revisao')),
  tentativas      INT NOT NULL DEFAULT 1,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sincronizado_em TIMESTAMPTZ,
  erro            TEXT
);

-- Auditoria de ações administrativas ------------------------------------------------------
CREATE TABLE auditoria_acoes (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  UUID REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  entidade    TEXT NOT NULL,
  entidade_id TEXT,
  data_hora   TIMESTAMPTZ NOT NULL DEFAULT now(),
  detalhes    JSONB
);
CREATE INDEX auditoria_data_idx ON auditoria_acoes (data_hora DESC);

-- Configurações ---------------------------------------------------------------------------
CREATE TABLE configuracoes (
  chave          TEXT PRIMARY KEY,
  valor          TEXT NOT NULL,
  atualizado_por UUID REFERENCES usuarios(id),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Imutabilidade das transações (RN-11): só a coluna status pode mudar, e só para 'estornada'.
CREATE OR REPLACE FUNCTION transacoes_imutaveis() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transações não podem ser excluídas (RN-11)';
  END IF;
  IF (NEW.id, NEW.uuid_operacao, NEW.cliente_id, NEW.cartao_id, NEW.tipo, NEW.valor, NEW.data_hora, NEW.usuario_id, NEW.referencia_transacao_id)
     IS DISTINCT FROM
     (OLD.id, OLD.uuid_operacao, OLD.cliente_id, OLD.cartao_id, OLD.tipo, OLD.valor, OLD.data_hora, OLD.usuario_id, OLD.referencia_transacao_id)
  THEN
    RAISE EXCEPTION 'Transações confirmadas não podem ser editadas (RN-11)';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'confirmada' AND NEW.status = 'estornada') THEN
    RAISE EXCEPTION 'Mudança de status inválida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transacoes_imutaveis_trg
  BEFORE UPDATE OR DELETE ON transacoes
  FOR EACH ROW EXECUTE FUNCTION transacoes_imutaveis();
