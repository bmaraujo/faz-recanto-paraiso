# ADR-003 — Pagamento tratado fora do site

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Diverge da especificação inicial** (que previa Mercado Pago Checkout Pro) |
| **Decisor** | Proprietário |

## Contexto

A especificação inicial previa integração completa com **Mercado Pago Checkout Pro**:
criação de preferência, webhook com validação de assinatura HMAC, sinal + saldo,
cobrança automática do saldo por `cron`, estorno automático, idempotência de pagamento
e tratamento de pagamento aprovado após a expiração da reserva.

O proprietário determinou que **o pagamento será tratado fora do site**: combinado por
WhatsApp e recebido por Pix, transferência ou dinheiro. O site serve para ver
disponibilidade, controlar quando a casa está alugada e colocar o interessado em
contato com o administrador.

## Alternativas

| Opção | Complexidade | Custo | Atrito p/ hóspede | Controle do proprietário |
|---|---|---|---|---|
| **Pagamento fora do site** | **Baixa** | **Zero** | Precisa falar com alguém | **Total** |
| Mercado Pago Checkout Pro | **Alta** | ~4% + ~R$ 0,40 por transação | Mínimo | Médio (regras do gateway) |
| Pix estático (QR fixo) no site | Média | ~0% | Baixo | Total, mas **sem conciliação automática** |
| Pix dinâmico via API de banco | Alta | Varia | Baixo | Total |
| Link de pagamento gerado manualmente | Baixa | Taxa do gateway | Médio | Total |

## Decisão

**Nenhum processamento de pagamento no site.**

O sistema:
- mostra o valor **estimado** (deixando claro que é estimativa);
- segura as datas por um prazo quando o hóspede solicita
  ([ADR-010](./ADR-010-pre-reserva-com-expiracao.md));
- coloca o hóspede em contato com o administrador;
- permite ao administrador **registrar manualmente** o que recebeu, para controle
  próprio ([UC-A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md)).

Isso é uma decisão de **negócio do proprietário**, não técnica. Nosso papel foi
avaliar as consequências e desenhar o sistema para que a ausência de pagamento online
não quebre a garantia de ocupação — o que exigiu a pré-reserva com expiração.

## O que deixou de existir

Removido integralmente do escopo, em relação à especificação inicial:

| Componente | Complexidade eliminada |
|---|---|
| Lambda `webhook-mp` | Uma função inteira, com validação de assinatura HMAC |
| Criação de preferência de pagamento | Chamada externa com idempotência e tratamento de falha |
| Validação de assinatura `x-signature` | Manifest, HMAC-SHA256, `timingSafeEqual`, formato a confirmar na doc |
| Itens `PAGAMENTO#<id>` de idempotência | Uma entidade a menos no modelo |
| Sinal + saldo | Dois fluxos de cobrança, dois estados, dois e-mails, um cron |
| Cobrança automática de saldo | Agendamento, geração de link, lembrete |
| Estorno automático | Chamada de API com idempotência |
| Pagamento aprovado após expiração | **Três** caminhos distintos, incluindo estorno automático |
| Divergência de valor | Detecção e alerta |
| Conciliação | Toda a classe de problema |
| Credenciais de teste e produção do gateway | Dois segredos por stage |
| Cenários de sandbox | 8 cenários de teste de integração externa |
| PCI / dados de cartão | Nenhum dado financeiro do titular no sistema |

Estimativa: a integração de pagamento era provavelmente **30-40% da complexidade
total** do backend, e a maior fonte de casos de borda do projeto.

## Consequências

### Positivas
- **Complexidade drasticamente menor.** Uma Lambda a menos, uma entidade a menos,
  dezenas de casos de borda a menos.
- **Zero taxa por transação.** Em 5 reservas/mês a R$ 2.000, ~4% são **R$ 400/mês**.
- **Nenhum dado financeiro do titular** no sistema — ganho direto de LGPD e segurança.
- **Nenhuma dependência de terceiro** no caminho crítico. O gateway não cai porque não
  existe.
- Máquina de estados mais simples: 6 estados, todos com significado de negócio claro.
- Nada de PCI, nada de conciliação, nada de estorno.
- O proprietário mantém controle total da negociação — ele **quer** falar com quem vai
  ficar na casa dele.

### Negativas
- **Atrito para o hóspede.** Quem quer resolver às 23h de domingo, sem falar com
  ninguém, não consegue. Parte desses visitantes vai para o Airbnb.
- **A confirmação depende de um humano.** Se o proprietário demora, a solicitação
  expira e o negócio se perde. Por isso o painel destaca o prazo e o relatório mede a
  taxa de expiração ([UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md)).
- **O valor é estimativa.** Precisa estar dito em toda tela e e-mail, senão a
  expectativa do hóspede quebra.
- **Nenhuma garantia financeira na pré-reserva.** O hóspede segura a data sem
  compromisso; no-show de solicitação é grátis para ele.
- **O controle de pagamento é manual.** Se o admin não registrar, o relatório fica
  errado — e vai parecer defeito do sistema.
- Sem conciliação automática, erros de "já pagou?" dependem da memória e do registro
  do proprietário.

### O que fica mais difícil
- Vender para quem não quer interagir (um segmento real).
- Escalar para muitas casas com muitas reservas (o gargalo passa a ser o tempo do
  proprietário).
- Cobrar antecipadamente com garantia.

## Mitigações adotadas

| Consequência negativa | Mitigação |
|---|---|
| Atrito | WhatsApp em um clique, com mensagem pré-preenchida, em toda tela ([UC-P07](../02-casos-de-uso/publico/UC-P07-contato-direto.md)) |
| Demora na confirmação | Prazo destacado no painel; `PRAZO_EXPIRANDO_ADMIN` 6 h antes; taxa de expiração no relatório |
| Valor é estimativa | Aviso obrigatório junto ao valor, na tela e no e-mail |
| Data travada sem compromisso | Prazo de 48 h + possibilidade de recusar + limite de 3 pendentes por e-mail |
| Controle manual de pagamento | Tela de registro com atalhos de 50%/100%; situação visível no painel e na lista |

## Quando revisar

Esta decisão **pode ser revertida** sem reescrever o sistema: a máquina de estados
suporta um estado de pagamento adicional, e a transação de ocupação não mudaria.

| Gatilho | Reconsiderar |
|---|---|
| Taxa de expiração alta **por demora do proprietário** | Pagamento online reduziria a dependência dele |
| Volume que o proprietário não consegue atender | Idem |
| Pedido explícito dos hóspedes por pagamento no site | Idem |
| Mais de ~5 casas com alta ocupação | O tempo do proprietário vira o gargalo |
| Prejuízo recorrente com no-show de pré-reserva | Sinal online criaria compromisso |

Se for revisto, a implementação sugerida é **mais simples que a da especificação
inicial**: um link de pagamento gerado pelo admin no backoffice (sem webhook, sem
sinal/saldo automático), e só depois, se necessário, o checkout completo.
