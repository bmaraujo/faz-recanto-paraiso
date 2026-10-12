# 02 — LGPD

> ⚠️ Este documento descreve as **decisões técnicas** de tratamento de dados pessoais.
> **Não é parecer jurídico.** A política de privacidade publicada e as obrigações do
> controlador devem ser revisadas por um advogado antes da produção. `[DEFINIR]`

## Papéis

| Papel | Quem |
|---|---|
| **Titular** | O interessado/hóspede que envia a solicitação |
| **Controlador** | O proprietário da fazenda `[DEFINIR]` nome e CNPJ/CPF |
| **Operadores** | AWS (infraestrutura e e-mail), GitHub (build), WhatsApp/Meta (quando o titular inicia a conversa) |
| **Encarregado (DPO)** | O próprio proprietário `[DEFINIR]` e-mail de contato |

## Dados tratados

### Do hóspede

| Dado | Finalidade | Base legal (art. 7º) | Obrigatório |
|---|---|---|---|
| Nome | Identificar e se dirigir ao hóspede | Execução de contrato (V) | **Sim** |
| E-mail | Enviar confirmação e instruções; acesso à solicitação | Execução de contrato (V) | Sim (site) / Não (manual) |
| Telefone | Contato para fechar a reserva | Execução de contrato (V) | Não (site) / Sim se não houver e-mail |
| Número de hóspedes | Calcular o valor e respeitar a capacidade | Execução de contrato (V) | **Sim** |
| Datas da estadia | O objeto da reserva | Execução de contrato (V) | **Sim** |
| Observação livre | Atender a um pedido do próprio titular | Execução de contrato (V) | Não |
| Valor combinado e recebido | Controle do proprietário | Legítimo interesse (IX) | Não |
| Aceite dos termos (data/hora) | Comprovar o consentimento informado | Cumprimento de obrigação (II) | **Sim** |

### Do administrador
E-mail e `sub` do Cognito, para autenticação e auditoria. Base legal: execução de
contrato com o próprio controlador.

### Hash de e-mail (antiabuso)
`sha256(e-mail normalizado)` em um item com TTL de 7 dias, para contar solicitações
pendentes. **Pseudonimizado**: cumpre a finalidade sem armazenar o dado em claro.

## Dados que NÃO tratamos

Explicitamente fora do escopo:

| Não coletamos | Por quê |
|---|---|
| CPF, RG, passaporte | Nenhuma finalidade. Validado: campos de pagamento **rejeitam** padrões de CPF ([UC-A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md)) |
| Dados de cartão, chave Pix, conta bancária | Pagamento é fora do site ([ADR-003](../adr/ADR-003-pagamento-fora-do-site.md)) |
| Endereço do hóspede | Nenhuma finalidade |
| Data de nascimento | Nenhuma finalidade |
| Documento de menores | Nenhuma finalidade |
| Localização do dispositivo | Nenhuma finalidade |
| Cookies de rastreamento | Nenhum analytics por padrão |
| IP para perfilamento | Logs de acesso do CloudFront **desligados** |
| Dados sensíveis (art. 5º, II) | Nenhuma finalidade |

> **Não coletar é a melhor proteção.** Cada campo a menos é uma obrigação a menos, um
> vazamento possível a menos e uma tela a menos para explicar. O escopo mínimo aqui é
> uma decisão de conformidade, não de preguiça.

## Princípios aplicados (art. 6º)

| Princípio | Como se aplica |
|---|---|
| **Finalidade** | Cada campo tem finalidade declarada na tabela acima e na política publicada |
| **Adequação** | Nenhum campo coletado "por garantia" |
| **Necessidade** | Só nome + um contato são obrigatórios; o resto é opcional |
| **Livre acesso** | O titular vê a própria solicitação em `/reserva/<id>?t=` |
| **Qualidade** | O titular pode pedir correção; o admin edita no backoffice |
| **Transparência** | Política publicada em `/privacidade`, com aceite registrado |
| **Segurança** | Ver [01 — Segurança](./01-seguranca.md) |
| **Prevenção** | Validação, escape, token, mascaramento em log |
| **Não discriminação** | Nenhum tratamento automatizado de decisão |
| **Responsabilização** | Este documento + histórico de transições por reserva |

## Ciclo de vida do dado

```
COLETA
  formulário do site (titular informa) ou backoffice (admin informa, reserva manual)
  → aceite dos termos registrado com data/hora
    │
    ▼
USO
  cálculo da reserva · comunicação por e-mail · contato por WhatsApp · agenda do admin
    │
    ▼
RETENÇÃO
  reserva ativa              → enquanto durar
  reserva CONCLUIDA          → 5 anos (prazo prescricional civil) [DEFINIR]
  solicitação EXPIRADA/RECUSADA → 90 dias (ttl)
  hash de antiabuso          → 7 dias (ttl)
  logs                       → 14 dias (já mascarados)
    │
    ▼
ANONIMIZAÇÃO
  após o prazo: nome → "Hóspede", e-mail e telefone → removidos,
  observação → removida. Datas, valores e casa **permanecem** (dado estatístico).
```

### Por que anonimizar em vez de excluir

A reserva anonimizada continua sendo útil como histórico de ocupação e receita
([UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md)), sem nenhum dado
pessoal. Excluir o registro inteiro destruiria o histórico do negócio sem ganho de
privacidade — depois da anonimização, não há mais titular identificável.

### Implementação da anonimização

Tarefa opcional no `cron-diario`, uma vez por dia:

```
Query GSI1 PK=RESERVA, SK < <hoje − 5 anos>
Para cada reserva CONCLUIDA/CANCELADA com checkout além do prazo:
  Update:
    SET hospede = { nome: "Hóspede", email: null, telefone: null },
        observacaoHospede = null,
        anonimizadaEm = :agora
    REMOVE tokenAcesso, pagamento.lancamentos[*].observacao
```

Operação **irreversível**. Por isso: prazo configurável, log da operação (só
`reservaId`), e o PITR como última rede se houver erro de prazo.

> **Fase:** a anonimização só é relevante a partir do quinto ano de operação. Deve ser
> implementada antes disso, mas não é bloqueador do lançamento — está anotada como
> Fase 3+ em [fases](../06-planejamento/01-fases-e-criterios-de-aceite.md).

## Direitos do titular (art. 18)

| Direito | Como atender | Prazo |
|---|---|---|
| **Confirmação de tratamento** | Responder por e-mail | 15 dias |
| **Acesso** | O link `/reserva/<id>?t=` já dá acesso; sob pedido, o admin exporta o detalhe | 15 dias |
| **Correção** | O admin edita no backoffice ([UC-A11](../02-casos-de-uso/admin/UC-A11-criar-reserva-manual.md)) | imediato |
| **Anonimização / eliminação** | Anonimização manual pelo admin (ação no detalhe da reserva) | 15 dias |
| **Portabilidade** | Exportar o detalhe da reserva em JSON/PDF | 15 dias |
| **Informação sobre compartilhamento** | Lista de operadores na política publicada | 15 dias |
| **Revogação de consentimento** | Não se aplica à execução do contrato; aplica-se ao `POS_ESTADIA` (marketing), que pode ser desativado | imediato |
| **Oposição** | Avaliar caso a caso | 15 dias |

### Ação de anonimização no backoffice

Para atender a um pedido de eliminação, o detalhe da reserva tem:

```
[ Anonimizar dados do hóspede ]
  ⚠ Ação irreversível. Remove nome, e-mail, telefone e observação
    desta reserva. As datas e os valores permanecem para o histórico.
    Use quando o hóspede solicitar a exclusão dos dados (LGPD).
  [ ] Entendo que esta ação é irreversível
```

Só permitido em reservas em estado final (`CONCLUIDA`, `CANCELADA`, `RECUSADA`,
`EXPIRADA`). Anonimizar uma reserva **ativa** impediria o próprio atendimento —
nesse caso, o caminho é cancelar e então anonimizar.

> Essa ação não existia nos UCs anteriores e precisa entrar em
> [UC-A06](../02-casos-de-uso/admin/UC-A06-ver-agenda.md) como ação do detalhe, na
> Fase 3.

## Operadores e transferência internacional

| Operador | O que acessa | Localização | Base |
|---|---|---|---|
| **AWS** | Todos os dados (hospedagem, banco, e-mail) | `us-east-1` — **Estados Unidos** | Cláusulas contratuais padrão da AWS; DPA do AWS |
| **GitHub** | **Nenhum dado pessoal** (só conteúdo das casas no build) | EUA | — |
| **WhatsApp/Meta** | A conversa, quando o titular a inicia | EUA | Relação direta titular ↔ Meta |
| **Airbnb/Booking** | **Apenas datas** no `.ics` | EUA | Nenhum dado pessoal transferido |

### Transferência internacional (art. 33)

Os dados ficam em **`us-east-1` (Estados Unidos)**. Isso é uma transferência
internacional e precisa estar **declarado na política de privacidade**.

A escolha é de custo: `us-east-1` é a região mais barata e o ACM do CloudFront exige
certificado lá.

**Alternativa a considerar:** `sa-east-1` (São Paulo) manteria os dados no Brasil, o
que simplifica a conformidade e melhora a latência da API. Custa mais (tipicamente
20-40% a mais por serviço) e exigiria manter o certificado do CloudFront em
`us-east-1` de qualquer forma. `[DEFINIR]` — vale a decisão explícita do proprietário,
não só a herança do custo.

> Esta é uma decisão em que a conformidade e o custo apontam para lados diferentes.
> Documentar a escolha e a justificativa é parte da responsabilização (art. 6º, X).

## Política de privacidade — conteúdo obrigatório

A página `/privacidade` ([UC-A13](../02-casos-de-uso/admin/UC-A13-configuracao-geral.md))
precisa conter, em linguagem simples:

- [ ] Quem é o controlador (nome, CNPJ/CPF, endereço)
- [ ] Contato do encarregado (e-mail)
- [ ] Quais dados são coletados, campo por campo
- [ ] Para que cada dado é usado
- [ ] A base legal de cada tratamento
- [ ] Por quanto tempo cada dado é guardado
- [ ] Com quem é compartilhado (lista de operadores)
- [ ] **Que os dados ficam em servidores nos Estados Unidos**
- [ ] Os direitos do titular e como exercê-los
- [ ] Que não há cookies de rastreamento
- [ ] Que o pagamento acontece fora do site e nenhum dado financeiro do titular é coletado
- [ ] Que o link de acompanhamento dá acesso à reserva a quem o tiver
- [ ] Data da última atualização

O último item da lista é frequentemente esquecido e é relevante: o modelo de
link-com-token significa que **encaminhar o e-mail compartilha o acesso**. O titular
precisa saber disso.

## Registro de operações de tratamento (art. 37)

Este documento, somado a:

| Fonte | O que registra |
|---|---|
| `historico` de cada reserva | Todas as transições, com autor e data |
| `historicoEnvios` | Todo e-mail enviado, com código e data |
| Log do CloudWatch (14 dias) | Operações, com dados mascarados |
| Histórico de versões de template e configuração | Alterações de conteúdo, com autor |
| `anonimizadaEm` | Quando o dado foi anonimizado |

Suficiente para demonstrar conformidade no porte do negócio.

## Incidente de segurança (art. 48)

Se houver vazamento de dado pessoal:

```
1. Conter: revogar acesso, corrigir a falha.
2. Avaliar em 24 h: quais dados, quantos titulares, qual o risco.
3. Registrar: o que aconteceu, quando, o que foi feito.
4. Comunicar à ANPD e aos titulares afetados em prazo razoável,
   se houver risco ou dano relevante.
5. Corrigir a causa raiz e adicionar o caso aos testes.
```

Dado o escopo mínimo coletado, o pior cenário realista é o vazamento de **nome,
e-mail, telefone e datas de estadia** — sem documento, sem dado financeiro, sem dado
sensível. Isso não reduz a obrigação, mas limita o dano.

Modelo de comunicação e contato da ANPD: `[DEFINIR]` com apoio jurídico.

## Checklist de conformidade antes da produção

- [ ] Política de privacidade publicada, revisada por advogado
- [ ] Controlador identificado com nome e documento
- [ ] Contato do encarregado publicado
- [ ] Transferência internacional declarada (ou migração para `sa-east-1` decidida)
- [ ] Prazos de retenção definidos e implementados (TTL)
- [ ] Aceite dos termos registrado com data/hora na reserva
- [ ] Nenhum cookie de rastreamento
- [ ] Logs de acesso do CloudFront desligados
- [ ] Logs da aplicação com dados mascarados (verificado)
- [ ] Campos de pagamento rejeitando CPF e cartão (verificado)
- [ ] Nenhum dado pessoal em endpoint público (verificado)
- [ ] Nenhum dado pessoal no `.ics` (verificado)
- [ ] Ação de anonimização disponível no backoffice
- [ ] Procedimento de incidente documentado
- [ ] Este documento revisado pelo proprietário
