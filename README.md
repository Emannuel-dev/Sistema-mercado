# Mercadinho — Controle de Clientes, Fiados e Cartões (MVP)

Implementação das fases 1 e 2 da especificação v1.1 (mais dashboard, usuários/permissões e
modo offline), seguindo a stack proposta no documento:

| Camada | Tecnologia |
| --- | --- |
| Front-end | React 18 + TypeScript (Vite) |
| Armazenamento local | IndexedDB via Dexie.js (fila offline e cache de clientes) |
| Back-end | Node.js + TypeScript + Fastify (API REST, JWT) |
| Banco central | PostgreSQL 14+ |
| Testes | Vitest contra um PostgreSQL real |

## Como rodar (desenvolvimento)

Pré-requisitos: Node.js 20+ e PostgreSQL.

```bash
# 1. Banco
createuser -P mercadinho          # senha: mercadinho (ou ajuste o .env)
createdb -O mercadinho mercadinho
createdb -O mercadinho mercadinho_test   # só para os testes

# 2. Dependências e configuração
npm install
cp server/.env.example server/.env       # troque o JWT_SECRET

# 3. Subir (dois terminais)
npm run dev:server    # API em http://localhost:3333 (aplica migrações e cria o admin)
npm run dev:web       # tela em http://localhost:5173
```

Primeiro acesso: usuário **admin**, senha **admin123**. O sistema obriga a troca da senha no
primeiro login. Para usar outra senha inicial, defina `ADMIN_SENHA` antes de subir o servidor.

## Produção (um único processo)

```bash
npm run build
cd server && node dist/index.js    # serve a API em /api e a tela compilada na raiz
```

Use HTTPS na frente (por exemplo, um proxy reverso) e configure `TZ=America/Sao_Paulo`.

## Testes

```bash
npm test
```

Cobrem limite de fiado, exceção autorizada, pagamentos parciais/totais e alocação nos débitos,
vencimentos, compra no cartão, bloqueio, virada idempotente, segunda via, estornos, imutabilidade
das transações no banco, autorização por perfil, sincronização com UUID repetido e
concorrência (dois caixas tentando usar o mesmo saldo).

## O que está pronto

- **Clientes:** cadastro (CPF opcional), busca por nome/telefone/CPF/nº do cartão, aviso de
  duplicidade por telefone, status ativo/inativo/bloqueado com motivo, histórico completo.
- **Fiados:** compra com vencimento por lançamento, limite individual, bloqueio de crédito,
  pagamento parcial/total (mais antigos primeiro ou débitos escolhidos), dias de atraso,
  listas de vencidos/a vencer, comprovante para impressão.
- **Cartões:** cadastro, consulta de saldo no balcão, compra com autorização por saldo,
  bloqueio/desbloqueio/cancelamento, segunda via, alteração de limite e dia de virada,
  virada automática (de hora em hora e na subida do servidor) e manual.
- **Estornos:** sempre por lançamento compensatório vinculado, com motivo; a original fica marcada
  como estornada. O banco recusa editar ou apagar transações (trigger).
- **Usuários e permissões:** perfis administrador, gerente e operador, checados no back-end;
  desativar sem perder histórico; redefinição de senha pelo administrador; sessão expira por
  inatividade (configurável).
- **Dashboard:** indicadores da seção 4.4, gráfico diário e alertas de vencimento e de limite.
- **Offline:** compra fiada e pagamento ficam numa fila local com UUID quando não há conexão e são
  enviados quando a internet volta. O servidor revalida tudo; o que falhar vai para "requer
  revisão" sem mexer no saldo. Tela de sincronização mostra pendências por caixa.
- **Auditoria:** login, alterações de cadastro, limites, bloqueios, viradas, usuários e
  configurações ficam em `auditoria_acoes`; todas as transações guardam usuário, dispositivo,
  origem e data/hora.

## Decisões adotadas (seção 16.2) — confirmar com o estabelecimento

1. **Virada do cartão:** o saldo que sobrou é substituído pelo novo limite (não acumula).
2. **Offline:** só compra fiada e pagamento. Compra no cartão exige conexão.
3. **Limite de fiado:** individual; só gerente/administrador autoriza exceder, com justificativa.
4. **Vencimento:** por compra; padrão de 30 dias (configurável).
5. **Pagamento acima do devido:** recusado.
6. **Estorno:** gerente e administrador; sempre do valor total. Compra fiada que já recebeu
   pagamento exige estornar o pagamento antes. Compra no cartão só pode ser estornada no mesmo ciclo.
7. **Segunda via:** mantém histórico e saldo; o número anterior é inativado na hora.

Mudar qualquer uma delas é uma alteração pequena e localizada nos serviços de `server/src/modules`.

## Próximos passos (roadmap)

- Relatórios com exportação PDF/Excel (seção 4.5).
- Backup automático do PostgreSQL e procedimento de restauração testado (seção 13).
- Notificações por WhatsApp/SMS (depende de serviço externo).
- Módulos de expansão: vendas, estoque, caixa e entregas.

## Estrutura

```
server/
  migrations/      SQL versionado (esquema, restrições, trigger de imutabilidade, dados base)
  src/modules/     fiado, cartões, estornos (regras) + rotas HTTP
  src/lib/         dinheiro em centavos, datas/competência, idempotência, auditoria
  test/            testes de regras, concorrência e API
web/
  src/offline.ts   fila Dexie + sincronização
  src/pages/       telas
```
