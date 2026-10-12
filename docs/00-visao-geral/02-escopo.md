# 02 — Escopo

## Dentro do escopo

### Site público
- Vitrine com várias casas: lista e página de detalhe por casa.
- Galeria de fotos com lightbox.
- Localização, como chegar, mapa sem API paga.
- Calendário de disponibilidade por casa.
- Simulador de preço (estimativa) por casa, datas e número de hóspedes.
- Formulário de solicitação de reserva, que segura as datas por um prazo.
- Página de acompanhamento da solicitação, acessada por link com token.
- Contato direto por WhatsApp e e-mail.
- Páginas legais: regras da casa, política de cancelamento, privacidade (LGPD), termos, FAQ.
- SEO: metatags, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD.
- Export de calendário iCal por casa, para importar em Airbnb/Booking.

### Backoffice (admin)
- Login com usuário e senha (Cognito).
- CRUD de casas: dados, descrição, comodidades, capacidade, quartos/camas, regras, localização.
- Upload, legenda, reordenação, foto principal e exclusão de fotos por casa.
- Configuração de preços por casa: diária base, fim de semana, temporadas, feriados,
  mínimo de noites, taxa de limpeza, hóspedes extras.
- Bloqueio e liberação de períodos por casa, com motivo.
- Agenda consolidada: visão mensal de todas as casas com reservas, bloqueios e
  eventos externos diferenciados por cor.
- Fila de solicitações pendentes com prazo restante visível.
- Confirmar, recusar, cancelar e estender o prazo de uma reserva.
- Registrar manualmente o pagamento recebido fora do site (valor, método, observação).
- Criar reserva manual (fechada por WhatsApp ou por outro canal).
- **Editar o assunto e o corpo de cada e-mail enviado pelo sistema**, com pré-visualização,
  envio de teste e restauração do texto padrão.
- Configuração geral: nome, WhatsApp, e-mails, prazo da pré-reserva, antecedência mínima,
  janela de reserva, textos legais.
- Publicar o conteúdo editado no site público.
- Relatório mensal: noites ocupadas, taxa de ocupação e receita registrada por casa.
- Sincronização de calendários externos (iCal de Airbnb/Booking) — importação e exportação.

### Infraestrutura
- Tudo provisionado por **Infrastructure as Code (AWS CDK)**, em dois ambientes: `dev` e `prod`.
- Alerta de orçamento por e-mail.

## Fora do escopo

| Item | Por quê |
|---|---|
| **Pagamento online** (cartão, Pix, checkout, estorno) | Decisão do proprietário: pagamento tratado fora do site. [ADR-003](../adr/ADR-003-pagamento-fora-do-site.md) |
| Contas de usuário para hóspedes | Acesso à solicitação por link com token. Menos dados pessoais, menos superfície de ataque. |
| App mobile | O site é mobile-first; um app não se paga nesse volume. |
| Emissão de nota fiscal | Responsabilidade contábil do proprietário, fora do sistema. |
| Multi-tenant (outras fazendas) | Um único proprietário. Múltiplas **casas** sim; múltiplos **donos** não. |
| Cupons de desconto | Sem pagamento online, o desconto é negociado direto. O admin aplica um desconto manual na reserva. |
| Chat no site | WhatsApp resolve, custo zero. |
| Avaliações de hóspedes com moderação | Fase futura. Por ora, depoimentos cadastrados pelo admin como conteúdo. |
| Analytics com cookies de rastreamento | Privacidade e LGPD. Se necessário, analytics sem cookies. |

## Mudanças em relação à especificação inicial

A especificação em `_referencia/especificacao-inicial-v0.md` foi revisada. O que mudou:

| # | Spec inicial | Agora | ADR |
|---|---|---|---|
| 1 | Uma única casa; multi-propriedade fora de escopo | **N casas** cadastráveis no backoffice | [004](../adr/ADR-004-multiplas-casas.md) |
| 2 | Mercado Pago Checkout Pro, webhook, estorno automático | **Sem pagamento online.** Lambda `webhook-mp` eliminada | [003](../adr/ADR-003-pagamento-fora-do-site.md) |
| 3 | Reserva confirmada pelo webhook de pagamento | Reserva **confirmada pelo administrador** | [010](../adr/ADR-010-pre-reserva-com-expiracao.md) |
| 4 | Bloqueio de 30 min (tempo de um checkout) | Pré-reserva com prazo **configurável, padrão 48 h** | [010](../adr/ADR-010-pre-reserva-com-expiracao.md) |
| 5 | Conteúdo em arquivos `.md`/`.json` no repositório | Conteúdo no **DynamoDB**, editável no backoffice, publicado por pipeline | [009](../adr/ADR-009-conteudo-no-banco-com-publicacao.md) |
| 6 | Templates de e-mail fixos no código | Templates **editáveis no backoffice**, com padrão no código como fallback | [007](../adr/ADR-007-templates-email-no-banco.md) |
| 7 | IaC com AWS SAM | IaC com **AWS CDK (TypeScript)** | [005](../adr/ADR-005-cdk-como-iac.md) |
| 8 | Estados `SINAL_PAGO`, `PAGA`, `PENDENTE_PAGAMENTO` | Estados `SOLICITADA`, `CONFIRMADA`, `RECUSADA`, `EXPIRADA`, `CANCELADA`, `CONCLUIDA` + campo separado de situação de pagamento | — |
| 9 | CRUD de cupons | Removido; desconto manual na reserva | — |
| 10 | Sinal/saldo com cobrança automática | Removido; o admin registra o que recebeu | [003](../adr/ADR-003-pagamento-fora-do-site.md) |

### O que foi mantido da spec inicial

Boas decisões que continuam valendo, com crédito: site estático em S3+CloudFront,
DynamoDB tabela única, Lambda Function URLs atrás do CloudFront, SSM Parameter Store
para segredos, Cognito para o admin, EventBridge para agendamentos, SES para e-mail,
item de **ocupação por noite** como garantia contra dupla reserva, cálculo de preço
como função pura testada, retenção de log de 14 dias, alerta de orçamento, e a
disciplina de centavos inteiros e datas sem hora.
