# Documentação — Recanto Paraíso

Índice e mapa de leitura da documentação do projeto.

## Como está organizado

| Pasta | O que contém | Para quem |
|---|---|---|
| [`00-visao-geral/`](#00--visão-geral) | Contexto, escopo, glossário, personas | Todos |
| [`01-negocio/`](#01--negócio) | Regras de negócio independentes de tecnologia | Proprietário e devs |
| [`02-casos-de-uso/`](#02--casos-de-uso) | Um documento por caso de uso, com negócio **e** técnico | Devs |
| [`03-tecnico/`](#03--técnico) | Arquitetura, dados, API, infraestrutura, testes | Devs |
| [`04-operacao/`](#04--operação) | Deploy, runbook, custos | Devs e operador |
| [`05-conformidade/`](#05--conformidade) | Segurança e LGPD | Devs e proprietário |
| [`06-planejamento/`](#06--planejamento) | Fases, critérios de aceite, pendências | Todos |
| [`adr/`](#adr--decisões-de-arquitetura) | Decisões de arquitetura registradas | Devs |
| `_referencia/` | Especificação inicial (histórico, **não é mais a verdade**) | — |

> ⚠️ **A especificação inicial em `_referencia/especificacao-inicial-v0.md` está
> superada.** Ela descreve uma única casa e pagamento online via Mercado Pago.
> As decisões vigentes estão nos ADRs [003](./adr/ADR-003-pagamento-fora-do-site.md)
> e [004](./adr/ADR-004-multiplas-casas.md).

## Ordem de leitura sugerida

1. [Contexto e objetivos](./00-visao-geral/01-contexto-e-objetivos.md)
2. [Escopo](./00-visao-geral/02-escopo.md)
3. [Glossário](./00-visao-geral/03-glossario.md)
4. [Ciclo de vida da reserva](./01-negocio/03-ciclo-de-vida-da-reserva.md) — o coração do sistema
5. [Arquitetura](./03-tecnico/01-arquitetura.md)
6. [Modelo de dados](./03-tecnico/02-modelo-de-dados.md)
7. O caso de uso que você vai implementar
8. [Fases e critérios de aceite](./06-planejamento/01-fases-e-criterios-de-aceite.md)

---

## 00 — Visão geral

- [01 — Contexto e objetivos](./00-visao-geral/01-contexto-e-objetivos.md)
- [02 — Escopo (dentro, fora e mudanças sobre a spec inicial)](./00-visao-geral/02-escopo.md)
- [03 — Glossário](./00-visao-geral/03-glossario.md)
- [04 — Personas e jornadas](./00-visao-geral/04-personas-e-jornadas.md)

## 01 — Negócio

- [01 — Regras de disponibilidade](./01-negocio/01-regras-de-disponibilidade.md)
- [02 — Regras de preço](./01-negocio/02-regras-de-preco.md)
- [03 — Ciclo de vida da reserva](./01-negocio/03-ciclo-de-vida-da-reserva.md)
- [04 — Política de cancelamento](./01-negocio/04-politica-de-cancelamento.md)
- [05 — Comunicação e e-mails](./01-negocio/05-comunicacao-e-emails.md)

## 02 — Casos de uso

[Índice completo e convenção de formato](./02-casos-de-uso/README.md)

**Público**

| ID | Caso de uso |
|---|---|
| [UC-P01](./02-casos-de-uso/publico/UC-P01-navegar-vitrine.md) | Navegar na vitrine das casas |
| [UC-P02](./02-casos-de-uso/publico/UC-P02-consultar-disponibilidade.md) | Consultar disponibilidade |
| [UC-P03](./02-casos-de-uso/publico/UC-P03-simular-preco.md) | Simular o preço da estadia |
| [UC-P04](./02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) | Solicitar reserva |
| [UC-P05](./02-casos-de-uso/publico/UC-P05-acompanhar-solicitacao.md) | Acompanhar a solicitação |
| [UC-P06](./02-casos-de-uso/publico/UC-P06-cancelar-solicitacao.md) | Desistir da solicitação |
| [UC-P07](./02-casos-de-uso/publico/UC-P07-contato-direto.md) | Entrar em contato direto |
| [UC-P08](./02-casos-de-uso/publico/UC-P08-exportar-calendario-ical.md) | Exportar calendário iCal |

**Backoffice (admin)**

| ID | Caso de uso |
|---|---|
| [UC-A01](./02-casos-de-uso/admin/UC-A01-autenticar.md) | Autenticar no backoffice |
| [UC-A02](./02-casos-de-uso/admin/UC-A02-gerenciar-casas.md) | Cadastrar e editar casas |
| [UC-A03](./02-casos-de-uso/admin/UC-A03-gerenciar-fotos.md) | Gerenciar fotos de uma casa |
| [UC-A04](./02-casos-de-uso/admin/UC-A04-gerenciar-precos.md) | Configurar preços de uma casa |
| [UC-A05](./02-casos-de-uso/admin/UC-A05-gerenciar-bloqueios.md) | Bloquear e liberar períodos |
| [UC-A06](./02-casos-de-uso/admin/UC-A06-ver-agenda.md) | Ver a agenda consolidada |
| [UC-A07](./02-casos-de-uso/admin/UC-A07-confirmar-reserva.md) | Confirmar uma reserva |
| [UC-A08](./02-casos-de-uso/admin/UC-A08-recusar-ou-cancelar-reserva.md) | Recusar ou cancelar uma reserva |
| [UC-A09](./02-casos-de-uso/admin/UC-A09-estender-prazo.md) | Estender o prazo de uma solicitação |
| [UC-A10](./02-casos-de-uso/admin/UC-A10-registrar-pagamento.md) | Registrar pagamento recebido fora do site |
| [UC-A11](./02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md) | Criar reserva manual |
| [UC-A12](./02-casos-de-uso/admin/UC-A12-editar-templates-email.md) | Editar os textos dos e-mails |
| [UC-A13](./02-casos-de-uso/admin/UC-A13-configuracao-geral.md) | Ajustar a configuração geral |
| [UC-A14](./02-casos-de-uso/admin/UC-A14-publicar-site.md) | Publicar o conteúdo no site |
| [UC-A15](./02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md) | Consultar relatório de ocupação |
| [UC-A16](./02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) | Sincronizar calendários externos |

## 03 — Técnico

- [01 — Arquitetura](./03-tecnico/01-arquitetura.md)
- [02 — Modelo de dados](./03-tecnico/02-modelo-de-dados.md)
- [03 — API pública](./03-tecnico/03-api-publica.md)
- [04 — API do backoffice](./03-tecnico/04-api-admin.md)
- [05 — Concorrência e idempotência](./03-tecnico/05-concorrencia-e-idempotencia.md)
- [06 — E-mails e templates editáveis](./03-tecnico/06-emails-e-templates.md)
- [07 — Armazenamento de imagens](./03-tecnico/07-armazenamento-de-imagens.md)
- [08 — Autenticação e autorização](./03-tecnico/08-autenticacao-e-autorizacao.md)
- [09 — Publicação de conteúdo](./03-tecnico/09-publicacao-de-conteudo.md)
- [10 — Sincronização iCal](./03-tecnico/10-sincronizacao-ical.md)
- [11 — Frontend](./03-tecnico/11-frontend.md)
- [12 — Infraestrutura (CDK)](./03-tecnico/12-infraestrutura-cdk.md)
- [13 — Observabilidade](./03-tecnico/13-observabilidade.md)
- [14 — Estratégia de testes](./03-tecnico/14-estrategia-de-testes.md)

## 04 — Operação

- [01 — Ambientes e deploy](./04-operacao/01-ambientes-e-deploy.md)
- [02 — Runbook](./04-operacao/02-runbook.md)
- [03 — Custos](./04-operacao/03-custos.md)

## 05 — Conformidade

- [01 — Segurança](./05-conformidade/01-seguranca.md)
- [02 — LGPD](./05-conformidade/02-lgpd.md)

## 06 — Planejamento

- [01 — Fases e critérios de aceite](./06-planejamento/01-fases-e-criterios-de-aceite.md)
- [02 — Pendências do proprietário `[DEFINIR]`](./06-planejamento/02-pendencias-definir.md)
- [03 — Progresso de implementação](./06-planejamento/03-progresso-de-implementacao.md) — o que já foi construído em código, commit a commit

## ADR — Decisões de arquitetura

[Índice dos ADRs](./adr/README.md)

| ADR | Decisão |
|---|---|
| [001](./adr/ADR-001-hospedagem-estatica.md) | Site estático em S3 + CloudFront |
| [002](./adr/ADR-002-dynamodb-tabela-unica.md) | DynamoDB em tabela única |
| [003](./adr/ADR-003-pagamento-fora-do-site.md) | Pagamento tratado fora do site |
| [004](./adr/ADR-004-multiplas-casas.md) | Suportar múltiplas casas |
| [005](./adr/ADR-005-cdk-como-iac.md) | AWS CDK como IaC |
| [006](./adr/ADR-006-lambda-function-urls.md) | Lambda Function URLs em vez de API Gateway |
| [007](./adr/ADR-007-templates-email-no-banco.md) | Templates de e-mail no banco, editáveis |
| [008](./adr/ADR-008-cognito-para-admin.md) | Cognito para autenticar o admin |
| [009](./adr/ADR-009-conteudo-no-banco-com-publicacao.md) | Conteúdo no banco + publicação estática |
| [010](./adr/ADR-010-pre-reserva-com-expiracao.md) | Pré-reserva com expiração |
