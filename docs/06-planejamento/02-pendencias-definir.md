# 02 — Pendências do proprietário `[DEFINIR]`

Tudo que depende de uma decisão ou de um dado do proprietário. Até cada item ser
resolvido, use o valor de exemplo para desenvolver — **mas não vá para produção com
ele**.

A coluna **Bloqueia** diz a partir de qual fase o item se torna impedimento.

---

## Decisões já tomadas

| # | Item | Decisão | Data |
|---|---|---|---|
| 8.3 | Conta AWS | `627010764306` | 2026-10-12 |
| 8.4 | **Região** | `sa-east-1` para os dados; só o certificado ACM em `us-east-1` — [ADR-011](../adr/ADR-011-regiao-sa-east-1.md) | 2026-10-12 |
| 8.5 | PITR no DynamoDB | Ligado em `prod` | 2026-10-12 |
| 8.6 | Versionamento do bucket S3 | Ligado (~US$ 0,01/mês, protege as fotos) | 2026-10-12 |
| 8.9 | Limite do alerta de orçamento | US$ 5/mês | 2026-10-12 |
| 3.1 | **Prazo da pré-reserva** | Configurável no backoffice, em horas — já previsto em [UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md) (faixa 1–720 h, padrão 48) | 2026-10-12 |
| 2.3 | Dias de "fim de semana" | Sexta e sábado, como padrão configurável por casa | 2026-10-12 |
| 2.10 | Crianças contam para a capacidade | **Sim** | 2026-10-12 |
| 8.1, 8.2 | **Domínio e DNS** | **Adiados.** Até a decisão, usar os endereços padrão da AWS (domínio do CloudFront e do Cognito) | 2026-10-12 |

> ### Adiar o domínio tem consequência em cadeia
>
> Sem domínio não há como verificar um domínio no SES (DKIM, SPF, DMARC) nem sustentar
> o chamado de saída do sandbox — e esses eram justamente os dois itens de **prazo
> externo** desta lista. O efeito prático:
>
> - **Fases 0 e 1 não sofrem.** O CloudFront serve por `https://<id>.cloudfront.net`
>   com certificado próprio, e o Cognito pela Hosted UI padrão. Não há e-mail nessas
>   fases.
> - **Fase 2 pode ser construída e testada, mas não lançada.** Em sandbox o SES só
>   envia para destinatários verificados um a um, o que basta para desenvolver, e
>   **não** basta para escrever a um hóspede real.
>
> Ou seja: o domínio deixa de ser urgente agora, mas precisa estar decidido **antes do
> fim da Fase 1**, senão vira o gargalo da Fase 2. O prazo da AWS (~24 h) continua lá,
> só mudou de lugar na fila.

---

## Bloqueadores com prazo externo (resolver JÁ, na Fase 0)

| # | Item | Por que é urgente | Bloqueia | Situação |
|---|---|---|---|---|
| 1 | **Domínio** | Precisa estar registrado e com DNS apontando antes do ACM | Fase 2 | **adiado** — endereços padrão da AWS até lá |
| 2 | **Saída do sandbox do SES** | A AWS leva até ~24 h para responder o chamado | Fase 2 | espera o item 1 |
| 3 | **Verificação do domínio no SES** (DKIM, SPF, DMARC) | Depende de propagação de DNS | Fase 2 | espera o item 1 |
| 4 | **Conta AWS e região** | Define onde tudo é criado | Fase 0 | ✅ resolvido |

> Os itens 2 e 3 são os únicos com prazo que não depende de nós, e os dois dependem do
> item 1. Com o domínio adiado, eles saem do caminho das Fases 0 e 1 — mas o relógio
> deles passa a começar só quando o domínio for registrado. Ver a consequência em
> cadeia acima.

---

## 1. Identidade e conteúdo

| # | Item | Exemplo para desenvolver | Bloqueia |
|---|---|---|---|
| 1.1 | Nome oficial da fazenda | "Recanto Paraíso" | Fase 1 |
| 1.2 | Logotipo (SVG ou PNG com fundo transparente) | — | Fase 1 |
| 1.3 | Paleta de cores | Verdes de mata, terracota, madeira, areia | Fase 1 |
| 1.4 | Nome de cada casa | "Casa do Lago", "Casa da Mata" | Fase 1 |
| 1.5 | Texto de apresentação de cada casa | Lorem | Fase 1 |
| 1.6 | **Fotos de cada casa** (mín. 5, ideal 15-20) | — | **Fase 1** |
| 1.7 | Comodidades de cada casa | — | Fase 1 |
| 1.8 | Capacidade máxima de cada casa | 8 | Fase 1 |
| 1.9 | Quartos, banheiros e camas por ambiente | 3 quartos, 2 banheiros | Fase 1 |
| 1.10 | Depoimentos (se houver) | — | — |

> **1.6 é o item que mais impacta a conversão** e o único que não pode ser improvisado.
> Vale contratar um fotógrafo ou, no mínimo, fotografar com luz do dia, casa arrumada
> e enquadramentos amplos.

## 2. Preços

| # | Item | Exemplo | Bloqueia |
|---|---|---|---|
| 2.1 | Diária base por casa | R$ 500,00 | Fase 1 |
| 2.2 | Diária de fim de semana | R$ 650,00 | Fase 1 |
| 2.3 | Quais dias são "fim de semana" | Sexta e sábado | Fase 1 |
| 2.4 | Taxa de limpeza por estadia | R$ 250,00 | Fase 1 |
| 2.5 | Hóspedes inclusos no valor | 6 | Fase 1 |
| 2.6 | Valor por hóspede extra, por noite | R$ 50,00 | Fase 1 |
| 2.7 | Mínimo de noites padrão | 2 | Fase 1 |
| 2.8 | **Temporadas** (nome, datas, diária, mínimo) | Férias de julho: 01-31/07, R$ 700,00, mín. 3 | Fase 1 |
| 2.9 | **Feriados** (nome, datas, diária, mínimo) | Réveillon: 29/12-02/01, R$ 1.200,00, mín. 4 | Fase 1 |
| 2.10 | Crianças contam para a capacidade? | **Sim** (padrão adotado) | Fase 1 |
| 2.11 | Pets são aceitos? Há taxa? | — | Fase 1 |

## 3. Regras de reserva

| # | Item | Exemplo | Bloqueia |
|---|---|---|---|
| 3.1 | ~~**Prazo da pré-reserva**~~ | ✅ configurável no admin, padrão 48 h | — |
| 3.2 | Antecedência mínima | 1 dia | Fase 2 |
| 3.3 | Janela de reserva | 12 meses | Fase 2 |
| 3.4 | Máximo de solicitações pendentes por e-mail | 3 | Fase 2 |

> **3.1 era a decisão de produto mais importante desta lista**, e deixou de ser uma
> decisão de uma vez: o prazo é **configurável no backoffice, em horas**
> ([UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md), faixa 1–720 h),
> começa em 48 h e muda a próxima solicitação na hora, sem deploy. Prazo curto (24 h)
> libera datas rápido mas pressiona o hóspede; longo (72 h) é confortável mas trava
> datas. Dá para calibrar com a prática, e o admin ainda pode estender caso a caso
> ([UC-A09](../02-casos-de-uso/admin/UC-A09-estender-prazo.md)).

## 4. Política de cancelamento

| # | Item | Exemplo | Bloqueia |
|---|---|---|---|
| 4.1 | Faixas de devolução | > 30 dias: 100%; 15-30: 50%; < 15: 0% | Fase 2 |
| 4.2 | A taxa de limpeza é devolvida sempre? | Sim | Fase 2 |
| 4.3 | Texto completo da política | — | Fase 2 |
| 4.4 | Como tratar força maior | 100% ou reagendamento, a critério do proprietário | Fase 2 |

## 5. Regras da casa

| # | Item | Bloqueia |
|---|---|---|
| 5.1 | Festas e eventos são permitidos? | Fase 1 |
| 5.2 | Horário limite para som | Fase 1 |
| 5.3 | Pets | Fase 1 |
| 5.4 | Fumar | Fase 1 |
| 5.5 | Visitantes não hospedados | Fase 1 |
| 5.6 | Responsabilidade por danos | Fase 1 |
| 5.7 | Uso da piscina / lago (segurança, crianças) | Fase 1 |
| 5.8 | Churrasqueira e fogueira | Fase 1 |

## 6. Horários e chegada

| # | Item | Exemplo | Bloqueia |
|---|---|---|---|
| 6.1 | Horário de check-in | A partir das 14h | Fase 1 |
| 6.2 | Horário de check-out | Até as 12h | Fase 1 |
| 6.3 | **Endereço público** (município/região, vai para o site) | "Zona rural, Município X - UF" | Fase 1 |
| 6.4 | **Endereço completo** (só no `PRE_CHECKIN`) | — | Fase 3 |
| 6.5 | Como chegar (referências, trechos de estrada) | — | Fase 1 |
| 6.6 | Condição da estrada (asfalto, terra, precisa 4×4?) | — | Fase 1 |
| 6.7 | Sinal de celular e internet | — | Fase 1 |
| 6.8 | Contato do caseiro (nome e telefone) | — | Fase 3 |
| 6.9 | Senha de portão / instruções de acesso | — | Fase 3 |
| 6.10 | Distâncias para referências (cidade, mercado, hospital) | 12 km do centro | Fase 1 |
| 6.11 | O que o hóspede deve levar | — | Fase 3 |
| 6.12 | O que já tem na casa (roupa de cama, toalha, utensílios) | — | Fase 1 |

> **6.3 vs. 6.4 é uma decisão de segurança física**, não de conteúdo: o endereço exato
> de uma casa que fica vazia parte do ano não deve estar indexado no Google. Só vai para
> quem tem reserva confirmada.

## 7. Contato e comunicação

| # | Item | Exemplo | Bloqueia |
|---|---|---|---|
| 7.1 | **Número de WhatsApp** | +55 11 99999-9999 | Fase 1 |
| 7.2 | E-mail do administrador | proprietario@exemplo.com.br | Fase 2 |
| 7.3 | E-mail remetente | reservas@exemplo.com.br | Fase 2 |
| 7.4 | Nome que aparece como remetente | "Recanto Paraíso" | Fase 2 |
| 7.5 | Em quanto tempo o proprietário se compromete a responder | 24 horas | Fase 2 |
| 7.6 | Revisão dos textos dos e-mails | — | Fase 3 |

## 8. Infraestrutura e conta

| # | Item | Exemplo / recomendação | Bloqueia |
|---|---|---|---|
| 8.1 | **Domínio** | **adiado** — endereço padrão do CloudFront até a decisão | Fase 2 |
| 8.2 | DNS no Route 53 (US$ 0,50/mês) ou no Registro.br (grátis) | **adiado** com o 8.1; recomendação segue Route 53 | Fase 2 |
| 8.3 | ~~Conta AWS~~ | ✅ `627010764306` | — |
| 8.4 | ~~**Região**~~ | ✅ `sa-east-1` — ver [decisões tomadas](#decisões-já-tomadas) | — |
| 8.5 | ~~PITR no DynamoDB~~ | ✅ ligado em `prod` | — |
| 8.6 | ~~**Versionamento do bucket S3**~~ | ✅ ligado (~US$ 0,01/mês) | — |
| 8.7 | MFA no login do admin | **Recomendado** | Fase 2 |
| 8.8 | Analytics (sem cookie) ou nenhum | Nenhum por padrão | — |
| 8.9 | ~~Limite do alerta de orçamento~~ | ✅ US$ 5/mês | — |

> **8.4 era a decisão em que custo e conformidade divergiam.** Resolvida em favor da
> conformidade: `sa-east-1`, porque no nosso volume a diferença de custo é de centavos.
> A restrição do ACM vale só para o certificado, não para a região inteira —
> era o que a documentação original generalizava. Ver
> [ADR-011](../adr/ADR-011-regiao-sa-east-1.md).
>
> **8.6 foi ligado:** o versionamento havia sido desligado por custo, mas o risco de um
> `s3 sync --delete` apagar as fotos é real e irrecuperável. Por ~US$ 0,01/mês, vale. Ver [segurança](../05-conformidade/01-seguranca.md#o-que-não-fazemos-e-por-quê).

## 9. Jurídico e LGPD

| # | Item | Bloqueia |
|---|---|---|
| 9.1 | **Nome e CNPJ/CPF do controlador** | Fase 2 |
| 9.2 | Endereço do controlador | Fase 2 |
| 9.3 | E-mail do encarregado (DPO) | Fase 2 |
| 9.4 | **Política de privacidade revisada por advogado** | Fase 2 |
| 9.5 | Termos de uso | Fase 2 |
| 9.6 | Prazo de retenção de dados de reservas concluídas | Fase 3 (exemplo: 5 anos) |
| 9.7 | ~~Decisão sobre transferência internacional (item 8.4)~~ | ✅ não há: dados em `sa-east-1` |

## 10. Canais externos (Fase 4)

| # | Item | Bloqueia |
|---|---|---|
| 10.1 | A casa é anunciada no Airbnb? | Fase 4 |
| 10.2 | No Booking? | Fase 4 |
| 10.3 | URL do calendário iCal de cada canal | Fase 4 |
| 10.4 | Quem tem prioridade em caso de conflito | Fase 4 |

> Se 10.1 e 10.2 forem "não", **a Fase 4 inteira não deve ser implementada**.

---

## Resumo por fase

| Fase | Pendências que a bloqueiam |
|---|---|
| **Fase 0** | ✅ nenhuma — todas resolvidas |
| **Fase 1** | 1.1–1.9, 2.1–2.2, 2.4–2.9, 2.11, 5.1–5.8, 6.1–6.3, 6.5–6.7, 6.10, 6.12, 7.1 |
| **Fase 2** | 3.2–3.4, 4.1–4.4, 7.2–7.5, 8.1, 8.2, 8.7, 9.1–9.5, + domínio e SES fora do sandbox |
| **Fase 3** | 6.4, 6.8, 6.9, 6.11, 7.6, 9.6 |
| **Fase 4** | 10.1–10.4 |

## Como coletar isso do proprietário

Sugestão prática, porque uma lista de 70 itens de uma vez não é respondida:

| Momento | O que pedir |
|---|---|
| ~~Conversa 1 (antes da Fase 0)~~ | ✅ feita: conta, região e prazo da pré-reserva |
| Conversa 2 (durante a Fase 0) | Itens 1.1–1.9, 2.1–2.11 — identidade e preços |
| **Tarefa dele** | Item 1.6 — as fotos. É o que mais demora |
| Conversa 3 (durante a Fase 1) | Itens 5, 6 — regras e chegada |
| Conversa 4 (antes da Fase 2) | Itens 3, 4, 7, 9 — prazos, cancelamento, jurídico |
| Conversa 5 (durante a Fase 3) | Revisar os textos dos e-mails com ele |

O backoffice foi desenhado para que a maioria desses itens seja **preenchida por ele
mesmo**, não transcrita por um desenvolvedor. Depois da Fase 1, as conversas podem ser
"entre no sistema e preencha", não "me manda por WhatsApp que eu coloco".
