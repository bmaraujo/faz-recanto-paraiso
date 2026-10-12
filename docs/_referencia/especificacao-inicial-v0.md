# Especificação técnica — Site de aluguel da Casa da Fazenda

> Documento de insumo para implementação assistida por IA (Claude / Claude Code).
> Leia a seção **0. Instruções para o implementador** antes de qualquer coisa.

---

## 0. Instruções para o implementador

1. **Objetivo nº 1 é custo mínimo.** Não introduza nenhum serviço pago recorrente (EC2, Lightsail, RDS, NAT Gateway, ALB, WAF, Secrets Manager, API Gateway REST) sem perguntar ao proprietário. Meta: **até US$ 3/mês** na AWS, excluindo domínio e taxas do gateway de pagamento.
2. **Implemente por fases** (seção 12). Só avance para a próxima fase quando os critérios de aceite da atual estiverem atendidos e testados.
3. **Itens marcados com `[DEFINIR]`** são decisões ou dados do proprietário. Use os valores-exemplo para desenvolver, mas liste-os no README como pendências e pergunte antes de ir para produção.
4. **Verifique a documentação atual do Mercado Pago** (https://www.mercadopago.com.br/developers) antes de codificar a integração. Nomes de campos, cabeçalhos e formato da assinatura do webhook descritos aqui devem ser confirmados.
5. **Dinheiro sempre em centavos (inteiros).** Nunca use float para valores monetários.
6. **Fuso horário:** toda regra de data usa `America/Sao_Paulo`. Datas de estadia são strings `YYYY-MM-DD` (sem hora).
7. **Nenhum segredo no código ou no repositório.** Use SSM Parameter Store (SecureString).
8. **Escreva testes antes** para a lógica de preço e disponibilidade (são as partes críticas).
9. Mantenha o `README.md` atualizado com: como rodar localmente, como fazer deploy, variáveis/parâmetros necessários e pendências `[DEFINIR]`.
10. Na dúvida entre duas soluções, escolha a mais simples que atenda aos requisitos.

---

## 1. Contexto

O proprietário tem uma fazenda e aluga **uma única casa** por temporada (estadias curtas: fins de semana, feriados, férias). Hoje pode também anunciar em Airbnb/Booking. O site deve:

- Servir de vitrine da casa (fotos, comodidades, localização).
- Mostrar disponibilidade real e calcular preço.
- Receber reservas com pagamento online (Pix e cartão) via **Mercado Pago**.
- Automatizar e-mails ao hóspede.
- Sincronizar calendário com Airbnb/Booking para evitar overbooking.
- Ter um painel administrativo simples para o proprietário.

Volume esperado: centenas de visitas/mês, poucas reservas/mês. Um único administrador.

### Fora de escopo
- Múltiplas propriedades / multi-tenant.
- Contas de usuário para hóspedes (o hóspede acessa a reserva por link com token).
- App mobile.
- Emissão de nota fiscal.

---

## 2. Stack escolhida

| Camada | Tecnologia | Motivo |
|---|---|---|
| Frontend | **Astro** (output estático) + TypeScript; ilhas interativas com Preact ou JS puro | Site estático, rápido, ótimo SEO |
| Hospedagem frontend | **S3 + CloudFront** (Origin Access Control) | Centavos/mês, HTTPS grátis |
| Certificado | ACM (região `us-east-1`, exigência do CloudFront) | Grátis |
| DNS | Route 53 (US$ 0,50/mês) — ou manter DNS no Registro.br se preferir custo zero `[DEFINIR]` | |
| Backend | **AWS Lambda**, Node.js (runtime LTS mais recente suportado), TypeScript, bundling com esbuild | Free tier |
| Exposição HTTP | **Lambda Function URLs** (auth `NONE`), atrás do CloudFront no path `/api/*` | Grátis, evita CORS |
| Banco | **DynamoDB** on-demand, tabela única | Free tier |
| Agendamentos | **EventBridge Scheduler** | Grátis nesse volume |
| E-mail | **Amazon SES** | ~US$ 0,10 / 1.000 e-mails |
| Segredos | **SSM Parameter Store** (SecureString, parâmetros padrão) | Grátis |
| Auth admin | **Cognito User Pool** (1 usuário) com Hosted UI / Managed Login; validação do JWT na Lambda com `aws-jwt-verify` | Grátis nesse volume |
| Pagamento | **Mercado Pago — Checkout Pro** | Sem PCI, Pix + cartão |
| IaC | **AWS SAM** (`template.yaml`) | Nativo AWS, simples |
| Testes | Vitest; DynamoDB Local (Docker) para testes de integração | |

**Região:** `us-east-1` para tudo (mais barata; ACM do CloudFront precisa estar lá). A latência é irrelevante porque o frontend é servido pelo CloudFront. `[DEFINIR]` se o proprietário preferir `sa-east-1`.

**Atenção (pegadinha conhecida):** não use OAC do CloudFront com Function URL para rotas `POST` — exige que o cliente envie o hash do payload (`x-amz-content-sha256`). Use Function URL com auth `NONE` e valide tudo na própria Lambda.

---

## 3. Arquitetura

```
Navegador ──► CloudFront ──┬─► S3 (site estático Astro)
                           └─► /api/*  ──► Lambda "api-publica"
                                       ──► Lambda "api-admin" (JWT Cognito)
Mercado Pago ──► Function URL ──► Lambda "webhook-mp"
EventBridge (30 min) ──► Lambda "cron-ical" ──► baixa iCal Airbnb/Booking
EventBridge (diário 09:00 BRT) ──► Lambda "cron-diario" (e-mails, saldo, expirações)

Todas as Lambdas ──► DynamoDB (tabela única)
Lambdas ──► SES (e-mails)    Lambdas ──► API Mercado Pago
```

Lambdas:

| Função | Gatilho | Responsabilidade |
|---|---|---|
| `api-publica` | Function URL via CloudFront `/api/*` | disponibilidade, cotação, criar reserva, consultar reserva, export iCal |
| `api-admin` | Function URL via CloudFront `/api/admin/*` | CRUD de reservas, bloqueios, preços, cupons, relatório |
| `webhook-mp` | Function URL direta (cadastrada no painel do MP) | processar notificações de pagamento |
| `cron-ical` | EventBridge a cada 30 min | importar calendários externos |
| `cron-diario` | EventBridge diário 09:00 `America/Sao_Paulo` | e-mails automáticos, cobrança de saldo, marcar expiradas/concluídas |

Configuração das Lambdas: memória 256 MB, timeout 10 s (cron-ical 30 s), logs no CloudWatch com **retenção de 14 dias**.

---

## 4. Modelo de dados (DynamoDB, tabela única)

Tabela: `casa-fazenda` — chaves `PK` (string), `SK` (string). TTL no atributo `ttl` (epoch segundos).
GSI1: `GSI1PK`, `GSI1SK`.

> **Importante:** a exclusão por TTL do DynamoDB **não é imediata** (pode levar até ~48h). Nunca dependa do TTL para liberar datas. A lógica deve sempre comparar o atributo `expiraEm` com o horário atual. O TTL serve só para limpeza.

### 4.1 Reserva
```
PK = RESERVA#<reservaId>        (reservaId = ULID)
SK = META
GSI1PK = RESERVAS
GSI1SK = <checkin>#<reservaId>
atributos:
  status: PENDENTE_PAGAMENTO | SINAL_PAGO | PAGA | CANCELADA | EXPIRADA | CONCLUIDA
  origem: SITE | MANUAL
  checkin, checkout: "YYYY-MM-DD"
  noites: string[]               (datas das noites ocupadas = checkin até checkout-1)
  hospedes: number
  hospede: { nome, email, telefone }
  valores: { totalCentavos, sinalCentavos, saldoCentavos, descontoCentavos, detalhamento[] }
  cupom?: string
  tokenAcesso: string            (aleatório, 32 bytes base64url; para o hóspede consultar a reserva)
  pagamentos: [{ mpPaymentId, tipo: SINAL|SALDO|TOTAL, valorCentavos, status, metodo, data }]
  linkSaldo?: string
  expiraEm: ISO datetime         (só enquanto PENDENTE_PAGAMENTO)
  emailsEnviados: string[]       (ex.: ["CONFIRMACAO","PRE_CHECKIN"]) — idempotência
  criadoEm, atualizadoEm
  ttl?: number                   (só enquanto PENDENTE_PAGAMENTO; ex.: expiraEm + 7 dias)
```

### 4.2 Ocupação de noite (garante não haver dupla reserva)
```
PK = NOITE#<YYYY-MM-DD>
SK = OCUPACAO
atributos:
  tipo: RESERVA | BLOQUEIO | EXTERNO
  refId: reservaId | bloqueioId | "<canal>:<uid do evento iCal>"
  pendente: boolean              (true enquanto reserva aguarda pagamento)
  expiraEm?: ISO datetime        (se pendente)
  ttl?: number
```

Regra de gravação ao criar reserva — **uma `TransactWriteItems`** com:
- `Put` da reserva.
- Para cada noite: `Put` em `NOITE#<data>` com condição
  `attribute_not_exists(PK) OR (pendente = :true AND expiraEm < :agora)`.

Se a transação falhar por condição → retornar `409 DATAS_INDISPONIVEIS`.
Limite de 100 itens por transação → limitar estadia máxima a 60 noites.

### 4.3 Bloqueio manual
```
PK = BLOQUEIO#<bloqueioId>   SK = META
atributos: inicio, fim, motivo, noites[]
```
(+ itens `NOITE#` com `tipo = BLOQUEIO`, gravados na mesma transação)

### 4.4 Configuração de preços
```
PK = CONFIG   SK = PRECOS
atributos (ver seção 5): todos em centavos
```

### 4.5 Cupom
```
PK = CUPOM#<CODIGO>   SK = META
atributos: tipo: PERCENTUAL|FIXO, valor, validoAte?, usosMax?, usos, ativo
```

### 4.6 Idempotência de pagamento
```
PK = PAGAMENTO#<mpPaymentId>   SK = META
atributos: reservaId, tipo, status, processadoEm
```

### 4.7 Sincronização iCal
```
PK = ICAL#<canal>   SK = META
atributos: url (vem do SSM), ultimaSync, uidsAtivos: string[]
```

---

## 5. Regras de preço

Configuração (exemplo — `[DEFINIR]` valores reais):
```json
{
  "diariaBase": 50000,
  "diariaFimDeSemana": 65000,
  "noitesFimDeSemana": ["SEX", "SAB"],
  "temporadas": [
    { "nome": "Férias de julho", "inicio": "2027-07-01", "fim": "2027-07-31", "diaria": 70000, "minNoites": 3 }
  ],
  "feriados": [
    { "nome": "Réveillon", "inicio": "2026-12-29", "fim": "2027-01-02", "diaria": 120000, "minNoites": 4 }
  ],
  "minNoitesPadrao": 2,
  "maxNoites": 60,
  "taxaLimpeza": 25000,
  "hospedesInclusos": 6,
  "capacidadeMaxima": 10,
  "valorHospedeExtraPorNoite": 5000,
  "percentualSinal": 50,
  "diasAntesCheckinParaSaldo": 7,
  "antecedenciaMinimaDias": 1,
  "janelaReservaMeses": 12,
  "horarioCheckin": "14:00",
  "horarioCheckout": "12:00"
}
```

Algoritmo de cotação (função pura `calcularCotacao(config, checkin, checkout, hospedes, cupom?)`):
1. Validar: checkout > checkin; hospedes ≤ capacidadeMaxima; checkin ≥ hoje + antecedência; dentro da janela; noites ≤ maxNoites.
2. Para cada noite, a diária é definida por precedência: **feriado > temporada > fim de semana > base**.
3. `minNoites` exigido = maior `minNoites` entre feriados/temporadas que tocam a estadia, senão `minNoitesPadrao`.
4. Subtotal = soma das diárias + (hospedes − hospedesInclusos, se > 0) × valorHospedeExtraPorNoite × noites.
5. Desconto do cupom incide sobre o subtotal de diárias (não sobre a limpeza).
6. Total = subtotal − desconto + taxaLimpeza.
7. Sinal = arredondar(total × percentualSinal / 100). Se faltam ≤ `diasAntesCheckinParaSaldo` dias para o checkin, **cobrar 100%** à vista (sinal = total, saldo = 0).
8. Retornar detalhamento linha a linha (cada noite com o tipo de tarifa aplicada).

**A cotação é sempre recalculada no servidor ao criar a reserva.** O valor enviado pelo navegador é ignorado.

Testes obrigatórios: fim de semana, virada de temporada no meio da estadia, feriado com mínimo de noites, hóspedes extras, cupom percentual e fixo, reserva em cima da hora (100% à vista), arredondamento de centavos.

---

## 6. API

Respostas em JSON. Erros no formato `{ "erro": "CODIGO", "mensagem": "texto amigável" }`.
Validação de entrada com **zod**.

### 6.1 Pública (`api-publica`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/disponibilidade?de=YYYY-MM-DD&ate=YYYY-MM-DD` | Lista de noites ocupadas no intervalo (máx. 13 meses). Noites pendentes não expiradas contam como ocupadas. Sem dados pessoais. Cache CloudFront 60 s. |
| POST | `/api/cotacao` | `{checkin, checkout, hospedes, cupom?}` → cotação detalhada ou erro de validação/indisponibilidade. |
| POST | `/api/reservas` | `{checkin, checkout, hospedes, nome, email, telefone, cupom?, aceiteTermos: true, honeypot}` → `{reservaId, tokenAcesso, initPoint}`. Ver seção 7. |
| GET | `/api/reservas/{id}?t=<tokenAcesso>` | Status e resumo da reserva para a página de acompanhamento. 404 se token inválido. |
| GET | `/api/calendario.ics?t=<tokenIcal>` | Export iCal das noites ocupadas (para importar no Airbnb/Booking). Token fixo no SSM. |

Proteções anti-abuso (sem custo): campo honeypot no formulário; limite de 3 reservas pendentes por e-mail; validação de e-mail e telefone. Se a conta permitir, definir concorrência reservada baixa nas Lambdas públicas.

### 6.2 Admin (`api-admin`) — exige `Authorization: Bearer <JWT Cognito>`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/reservas?de=&ate=&status=` | Lista via GSI1 |
| GET | `/api/admin/reservas/{id}` | Detalhe |
| POST | `/api/admin/reservas` | Reserva manual (fechada por WhatsApp). Opcional: gerar link de pagamento. |
| POST | `/api/admin/reservas/{id}/cancelar` | `{reembolso: TOTAL|PARCIAL|NENHUM, valorCentavos?, motivo}` → libera noites, estorna via MP, envia e-mail |
| POST | `/api/admin/reservas/{id}/link-pagamento` | Gera/reenvia link de sinal ou saldo |
| POST | `/api/admin/bloqueios` | `{inicio, fim, motivo}` |
| DELETE | `/api/admin/bloqueios/{id}` | Remove bloqueio e libera noites |
| GET / PUT | `/api/admin/precos` | Lê/salva configuração de preços (validar com zod) |
| GET / POST / PUT | `/api/admin/cupons` | CRUD de cupons |
| GET | `/api/admin/relatorio?ano=&mes=` | Faturamento recebido, noites ocupadas, taxa de ocupação, por canal |
| POST | `/api/admin/ical/sincronizar` | Dispara sincronização manual |

---

## 7. Integração Mercado Pago (Checkout Pro)

### 7.1 Credenciais (SSM)
- `/casa-fazenda/mp/access-token` (SecureString)
- `/casa-fazenda/mp/webhook-secret` (SecureString)
- Usar credenciais **de teste** em `dev` e de produção em `prod` (parâmetros separados por stage).

### 7.2 Criar reserva + preferência (`POST /api/reservas`)
1. Validar entrada e recalcular cotação.
2. Gerar `reservaId` (ULID) e `tokenAcesso`.
3. `expiraEm = agora + 30 min`.
4. Gravar transação (seção 4.2). Se 409 → retornar erro amigável.
5. Criar preferência:

```ts
const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Idempotency-Key": `${reservaId}:${tipo}`,
  },
  body: JSON.stringify({
    items: [{
      id: reservaId,
      title: `Casa da Fazenda – ${fmt(checkin)} a ${fmt(checkout)} (${tipoLabel})`,
      quantity: 1,
      unit_price: valorCentavos / 100,
      currency_id: "BRL",
    }],
    payer: { name: nome, email },
    external_reference: `${reservaId}:${tipo}`,      // tipo = SINAL | SALDO | TOTAL
    notification_url: `${WEBHOOK_URL}?source_news=webhooks`,
    back_urls: {
      success: `${SITE_URL}/reserva/${reservaId}?t=${tokenAcesso}`,
      pending: `${SITE_URL}/reserva/${reservaId}?t=${tokenAcesso}`,
      failure: `${SITE_URL}/reserva/${reservaId}?t=${tokenAcesso}`,
    },
    auto_return: "approved",
    expires: true,
    expiration_date_to: expiraEm,                     // alinhado ao bloqueio das datas
    statement_descriptor: "CASAFAZENDA",              // [DEFINIR]
  }),
});
```

6. Se a criação da preferência falhar → desfazer a pré-reserva (apagar itens) e retornar 502.
7. Retornar `init_point` para o frontend redirecionar.

### 7.3 Webhook (`webhook-mp`)
1. Ler `type`/`topic` e `data.id` (query string e/ou corpo). Se não for evento de pagamento → responder 200 e ignorar.
2. **Validar assinatura** (`x-signature` = `ts=...,v1=...`; `x-request-id`). Confirmar formato na documentação atual:
```ts
const parts = Object.fromEntries(
  headers["x-signature"].split(",").map((p) => p.trim().split("=") as [string, string])
);
const manifest = `id:${dataId};request-id:${headers["x-request-id"]};ts:${parts.ts};`;
const hmac = crypto.createHmac("sha256", webhookSecret).update(manifest).digest("hex");
const ok = hmac.length === parts.v1?.length &&
  crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(parts.v1));
if (!ok) return { statusCode: 401 };
```
   (Se `data.id` for alfanumérico, usar em minúsculas no manifest, conforme documentação.)
3. Buscar o pagamento: `GET https://api.mercadopago.com/v1/payments/{id}` com o access token. **Nunca confiar no corpo da notificação.**
4. Extrair `external_reference` → `reservaId` e `tipo`. Carregar reserva; se não existir → logar e responder 200.
5. Conferir `transaction_amount` × valor esperado para o tipo. Divergência → logar como alerta, não confirmar, e-mail para o admin.
6. Registrar `PAGAMENTO#<id>` com `attribute_not_exists` (idempotência). Se já existir com o mesmo status → responder 200.
7. Por status:
   - `approved`:
     - Reserva `PENDENTE_PAGAMENTO` e não expirada → atualizar (condicional) para `SINAL_PAGO` (se tipo SINAL e saldo > 0) ou `PAGA`; remover `pendente`/`expiraEm`/`ttl` dos itens `NOITE#` (transação).
     - Reserva expirada mas **noites ainda livres** → regravar noites e confirmar.
     - Reserva expirada e noites tomadas → **estornar automaticamente** (`POST /v1/payments/{id}/refunds`), marcar `CANCELADA`, e-mail ao hóspede e ao admin.
     - Tipo SALDO em reserva `SINAL_PAGO` → `PAGA`.
     - Enviar e-mail de confirmação (verificar `emailsEnviados`).
   - `pending` / `in_process` → apenas registrar.
   - `rejected` / `cancelled` → registrar; reserva permanece pendente até expirar.
   - `refunded` / `charged_back` → registrar, e-mail ao admin.
8. Responder **200** rapidamente (todo o processamento acima é rápido; não há fila).

### 7.4 Página de retorno
`/reserva/[id]?t=...` **não confirma nada**. Mostra "Processando pagamento" e consulta `GET /api/reservas/{id}` a cada 3 s (até 2 min), depois exibe o status final. O redirecionamento pode não ocorrer; o webhook é a fonte da verdade.

### 7.5 Sinal + saldo
- Se `saldoCentavos > 0`, o `cron-diario` gera a preferência de SALDO quando faltarem `diasAntesCheckinParaSaldo` dias e envia o link por e-mail (sem expiração curta; `expiration_date_to` = véspera do check-in).
- Lembrete 2 dias depois se não pago. Se não pago até a véspera → e-mail ao admin (decisão manual).

### 7.6 Estorno
`POST https://api.mercadopago.com/v1/payments/{id}/refunds` — corpo vazio para total, `{ "amount": valor }` para parcial. Usar `X-Idempotency-Key`.

### 7.7 Cenários de teste (sandbox com usuários de teste)
- Cartão aprovado; cartão recusado; Pix pendente e depois aprovado.
- Pagamento aprovado após expiração com datas livres / com datas tomadas (estorno).
- Notificação duplicada; notificação com assinatura inválida; valor divergente.
- Duas pessoas tentando reservar as mesmas datas ao mesmo tempo.

---

## 8. Sincronização iCal (`cron-ical`)

- URLs de import no SSM: `/casa-fazenda/ical/airbnb`, `/casa-fazenda/ical/booking` `[DEFINIR]`.
- A cada execução, por canal: baixar `.ics` (timeout 10 s), parsear com `node-ical`, converter cada `VEVENT` em noites (DTEND é exclusivo).
- Diff com `uidsAtivos`: criar itens `NOITE#` com `tipo = EXTERNO` para novos; apagar os de eventos removidos; atualizar os alterados.
- **Conflito** (noite externa colide com reserva do site): não sobrescrever, registrar e enviar e-mail urgente ao admin.
- Falha de download: não apagar nada, só logar. Após 3 falhas seguidas → e-mail ao admin.
- Export (`/api/calendario.ics`): eventos `VEVENT` com `SUMMARY: Indisponível`, incluindo reservas do site e bloqueios, **excluindo** eventos importados (evita eco entre plataformas).

---

## 9. E-mails (SES)

Remetente `[DEFINIR]` (ex.: `reservas@dominio.com.br`). Verificar domínio com DKIM e **solicitar saída do sandbox do SES** antes da produção.
Templates em HTML simples + versão texto, em português, gerados no código (sem serviço externo).

| Código | Quando | Para |
|---|---|---|
| `CONFIRMACAO` | Pagamento aprovado (sinal ou total) | Hóspede (cópia admin) |
| `NOVA_RESERVA_ADMIN` | Pagamento aprovado | Admin |
| `LINK_SALDO` | D − `diasAntesCheckinParaSaldo` | Hóspede |
| `LEMBRETE_SALDO` | 2 dias após `LINK_SALDO` sem pagamento | Hóspede |
| `PRE_CHECKIN` | D − 3 (só se `PAGA`) | Hóspede — endereço, mapa, como chegar, horário, contato do caseiro, regras, senha/portão `[DEFINIR]` |
| `POS_ESTADIA` | D + 1 após checkout | Hóspede — agradecimento e pedido de avaliação |
| `CANCELAMENTO` | Cancelamento/estorno | Hóspede |
| `ALERTA_ADMIN` | Conflitos, divergências, falhas de sync | Admin |

Cada envio registra o código em `emailsEnviados` (nunca enviar duas vezes).

`cron-diario` também: marca `EXPIRADA` reservas pendentes vencidas e `CONCLUIDA` as com checkout no passado.

---

## 10. Frontend (Astro, estático)

Conteúdo editável em arquivos do repositório (`src/content/*.md` e `src/data/casa.json`): textos, comodidades, regras, FAQ, avaliações, fotos.

Páginas:
- `/` — hero com foto, destaques, galeria resumida, comodidades, avaliações, CTA "Ver disponibilidade".
- `/a-casa` — descrição completa, quartos/camas, comodidades com ícones, galeria completa (lightbox).
- `/localizacao` — mapa (iframe do Google Maps/OpenStreetMap, sem API paga), como chegar, condições da estrada, sinal de celular, distâncias.
- `/reservar` — calendário com noites ocupadas, seletor de hóspedes, cotação detalhada em tempo real, formulário do hóspede, aceite de regras/cancelamento/privacidade, botão "Ir para pagamento".
- `/reserva/[id]` — acompanhamento (ver 7.4); rota client-side.
- `/regras`, `/cancelamento`, `/faq`, `/privacidade`, `/termos` (LGPD).
- `/admin` — SPA client-side protegida por Cognito: calendário mensal com reservas/bloqueios/externos por cor, lista de reservas com filtros, detalhe + cancelar/estornar/reenviar link, bloqueios, preços (formulário), cupons, relatório mensal, botão sincronizar iCal.

Requisitos:
- Mobile-first; Lighthouse ≥ 90 em performance, acessibilidade e SEO.
- Imagens otimizadas (componente `<Image>` do Astro, WebP/AVIF, vários tamanhos, lazy loading).
- Botão flutuante de WhatsApp (`https://wa.me/<numero>?text=...`) `[DEFINIR]` número.
- SEO: `<title>`/meta por página, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD `VacationRental`/`LodgingBusiness`.
- Sem cookies de rastreamento por padrão. Analytics opcional e gratuito (ex.: CloudFront logs desligados; Cloudflare Web Analytics ou similar) `[DEFINIR]`.
- Paleta e identidade visual rústica/natural `[DEFINIR]` logo e cores.

---

## 11. Infraestrutura (SAM)

Recursos no `template.yaml`:
- Bucket S3 privado + CloudFront (OAC para S3), comportamento `/api/*` → origem Function URL `api-publica`, `/api/admin/*` → `api-admin` (sem cache, encaminhar `Authorization`), demais → S3. Cache padrão para estáticos; `index.html` com TTL curto.
- Função de CloudFront (viewer request) para reescrever URLs sem extensão para `index.html` e rota `/reserva/*` → página SPA.
- Certificado ACM + registro Route 53 (opcional).
- Tabela DynamoDB on-demand com GSI1 e TTL; **Point-in-time recovery ligado** (custo baixo nesse volume) `[DEFINIR]`.
- 5 Lambdas, Function URLs, roles com privilégio mínimo.
- EventBridge Scheduler (2 agendas, fuso `America/Sao_Paulo`).
- Cognito User Pool + App Client + domínio.
- Log groups com retenção 14 dias.
- **AWS Budgets**: alerta por e-mail em US$ 5/mês (criar via template ou instrução no README).
- Parâmetros por stage: `dev` e `prod`.

Deploy do site: `astro build` → `aws s3 sync` → invalidação CloudFront (script `npm run deploy:site`). Deploy do backend: `sam build && sam deploy`. Opcional: GitHub Actions com OIDC (sem chaves de longo prazo).

Estrutura do repositório:
```
/
├─ README.md
├─ docs/especificacao.md          (este arquivo)
├─ infra/template.yaml
├─ site/                          (Astro)
│  ├─ src/pages, src/components, src/content, src/data
│  └─ public/
└─ backend/
   ├─ src/handlers/   api-publica.ts, api-admin.ts, webhook-mp.ts, cron-ical.ts, cron-diario.ts
   ├─ src/lib/        precos.ts, disponibilidade.ts, reservas.ts, mercadopago.ts,
   │                  email.ts, ical.ts, db.ts, auth.ts, config.ts, datas.ts
   ├─ src/templates/  (e-mails)
   └─ test/
```

---

## 12. Fases e critérios de aceite

### Fase 0 — Fundação
- Repositório, SAM, deploy de bucket + CloudFront + tabela + alerta de orçamento.
- ✅ Página "em construção" no ar via HTTPS; `sam deploy` reproduzível; README com instruções.

### Fase 1 — Vitrine
- Todas as páginas públicas de conteúdo, galeria, localização, WhatsApp, SEO.
- `GET /api/disponibilidade` + calendário somente leitura em `/reservar` (com bloqueios criados via script/admin mínimo).
- Lógica de preço com testes e `POST /api/cotacao`; simulador de preço na página (reserva ainda via WhatsApp).
- ✅ Lighthouse ≥ 90; testes de preço passando; custo AWS do mês < US$ 1.

### Fase 2 — Reserva e pagamento
- `POST /api/reservas`, transação de noites, Checkout Pro, webhook, página de acompanhamento.
- E-mails `CONFIRMACAO`, `NOVA_RESERVA_ADMIN`, `CANCELAMENTO`.
- Admin: login, lista/detalhe de reservas, bloqueios, cancelar com estorno, editar preços.
- ✅ Todos os cenários da seção 7.7 testados no sandbox; teste de concorrência (2 reservas simultâneas nas mesmas datas → só uma passa).

### Fase 3 — Automação
- Sinal + saldo, `cron-diario` com todos os e-mails, sync iCal import/export, cupons, reserva manual, relatório.
- ✅ Sincronização testada com um calendário iCal real; e-mails nunca duplicados; conflito gera alerta.

---

## 13. Segurança e LGPD

- Dados pessoais mínimos (nome, e-mail, telefone). Não armazenar documentos nem dados de cartão.
- `tokenAcesso` obrigatório para ver qualquer reserva; `reservaId` sozinho não dá acesso.
- `/api/disponibilidade` e `.ics` nunca expõem dados de hóspedes.
- Logs sem dados pessoais completos (mascarar e-mail/telefone).
- Política de privacidade descrevendo finalidade, retenção e contato do controlador `[DEFINIR]`.
- Anonimizar dados de hóspede de reservas concluídas há mais de 5 anos `[DEFINIR]` prazo.
- Cabeçalhos de segurança no CloudFront (Response Headers Policy: HSTS, X-Content-Type-Options, Referrer-Policy, CSP básica).

---

## 14. Pendências do proprietário `[DEFINIR]`

- Nome da casa, textos, fotos, comodidades, capacidade, quartos/camas.
- Tabela de preços, temporadas, feriados, mínimo de noites, taxa de limpeza, hóspedes extras.
- Percentual de sinal e prazo do saldo.
- Política de cancelamento (prazos e percentuais de reembolso) e regras da casa (pets, festas, som, horários).
- Horários de check-in/check-out; instruções de chegada; contato do caseiro.
- Domínio, e-mail remetente, número de WhatsApp.
- Conta Mercado Pago (credenciais de teste e produção) e `statement_descriptor`.
- URLs iCal do Airbnb/Booking (se houver).
- DNS no Route 53 ou no Registro.br; região AWS; analytics; identidade visual.
