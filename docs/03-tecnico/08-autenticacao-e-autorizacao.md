# 08 — Autenticação e autorização

Há **dois** mecanismos completamente distintos, e confundi-los seria grave:

| Quem | Mecanismo | Protege |
|---|---|---|
| Administrador | JWT do Cognito User Pool | `/api/admin/*` — tudo |
| Hóspede | Token de acesso por reserva | apenas a própria reserva |

Não existe conta de hóspede. Não existe login público.

---

## 1. Administrador — Cognito User Pool

### Configuração do User Pool

| Item | Valor | Motivo |
|---|---|---|
| Login | **E-mail** | Um usuário; e-mail é o que ele lembra |
| Auto-registro | **Desabilitado** | O usuário é criado por IaC/CLI. Ninguém se cadastra |
| Recuperação | Por e-mail | |
| MFA | **Opcional, TOTP, recomendado** `[DEFINIR]` | Protege contra senha vazada. Decisão do proprietário |
| Política de senha | Mín. 12 chars, maiúscula, minúscula, número, símbolo | |
| Grupo | `admin` | O JWT precisa conter `cognito:groups` com `admin` |
| Interface | Hosted UI / Managed Login | Zero código de tela de login a manter |
| Fluxo | **Authorization Code + PKCE** | Único fluxo aceitável para SPA |
| `accessToken` | validade 1 h | |
| `refreshToken` | validade 30 dias | Evita login diário no celular |
| Prevenção de ataque | Advanced Security em modo `AUDIT` | Modo `ENFORCED` é pago; `AUDIT` é grátis e já loga tentativas |
| Custo | Grátis (free tier: 50.000 MAU) | |

> **Não use `implicit grant`.** Ele devolve o token na URL, que vai para o histórico
> do navegador e para o `Referer`. Code + PKCE é o padrão atual e a Hosted UI suporta.

### Fluxo no navegador

```
/admin  ─▶ SPA verifica se há token válido no sessionStorage
             │ não há
             ▼
        redireciona para a Hosted UI do Cognito (code + PKCE, state aleatório)
             │ admin digita e-mail e senha
             ▼
        volta para /admin/callback?code=...&state=...
             │ SPA valida o `state`, troca o code pelo token (PKCE verifier)
             ▼
        guarda os tokens e renderiza o backoffice
```

| Decisão | Valor | Motivo |
|---|---|---|
| Onde guardar os tokens | `sessionStorage` | Não vai em requisição automática (ao contrário de cookie), e morre ao fechar a aba |
| Por que não `localStorage` | Sobrevive ao fechamento do navegador; num celular compartilhado é pior | |
| Por que não cookie `HttpOnly` | Exigiria um endpoint de sessão e proteção CSRF. Com `Authorization: Bearer`, CSRF não se aplica | |
| Renovação | `refreshToken` em memória; renova quando faltam < 5 min | |
| Logout | Limpa o `sessionStorage` e chama o endpoint de logout do Cognito | |

> `sessionStorage` é vulnerável a XSS — como qualquer armazenamento acessível por JS.
> A defesa real contra isso é a CSP estrita e não injetar HTML não sanitizado na SPA
> (ver [segurança](../05-conformidade/01-seguranca.md)). A pré-visualização de template
> em `<iframe sandbox>` existe exatamente por isso.

### Validação do JWT na Lambda

Biblioteca: **`aws-jwt-verify`** (oficial da AWS, sem dependências nativas).

```ts
// lib/auth.ts — o verificador é criado FORA do handler, para reaproveitar o
// cache do JWKS entre invocações do mesmo container.
const verificador = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId:   process.env.USER_POOL_CLIENT_ID!,
  tokenUse:   "access",
  groups:     ["admin"],
});
```

Verificações obrigatórias em **toda** requisição a `/api/admin/*`:

| # | Verificação | Falha → |
|---|---|---|
| 1 | Cabeçalho `Authorization: Bearer <jwt>` presente | `401` |
| 2 | Assinatura válida contra o JWKS do User Pool | `401` |
| 3 | `iss` = o User Pool esperado | `401` |
| 4 | `client_id` = o App Client esperado | `401` |
| 5 | `token_use` = `access` | `401` |
| 6 | `exp` no futuro | `401` |
| 7 | `cognito:groups` contém `admin` | `403` |

A verificação acontece **antes** de qualquer leitura do banco, na primeira linha do
handler. Nenhuma rota de admin faz `GetItem` antes de autenticar.

> A Function URL tem `AuthType: NONE` e está exposta na internet
> ([arquitetura](./01-arquitetura.md)). Portanto a lista acima não é "defesa extra" —
> é **a** defesa. Não existe rota de admin não autenticada, nem em `dev`.

### Defesa em profundidade: cabeçalho de origem

O CloudFront adiciona `x-origem-cdn: <segredo do SSM>` às requisições para as Function
URLs. As Lambdas rejeitam com `403` quem não traz o valor correto.

Isso **não é autorização** — o segredo pode vazar e qualquer um pode enviar o
cabeçalho. Serve para:

- obrigar o tráfego a passar pelo CloudFront (onde há cache e headers de segurança);
- cortar varredura automatizada na Function URL antes de gastar com validação de JWT.

A rotação do segredo é anual e documentada no [runbook](../04-operacao/02-runbook.md).

### Criação do usuário admin

**Não** fica no IaC com senha. O CDK cria o User Pool, o App Client, o domínio e o
grupo `admin`. O usuário é criado uma vez, manualmente:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <id> \
  --username proprietario@exemplo.com.br \
  --user-attributes Name=email,Value=proprietario@exemplo.com.br Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL

aws cognito-idp admin-add-user-to-group \
  --user-pool-id <id> --username proprietario@exemplo.com.br --group-name admin
```

O Cognito envia a senha temporária por e-mail e exige a troca no primeiro acesso.
Nenhuma senha passa pelo repositório, pelo CDK ou pelo histórico do shell.

---

## 2. Hóspede — token de acesso por reserva

### Geração

```ts
const tokenAcesso = crypto.randomBytes(32).toString("base64url"); // 43 chars
```

- 32 bytes de `crypto.randomBytes` = 256 bits de entropia. Inviável de adivinhar.
- `base64url` para ir em URL sem escape.
- Gerado uma vez, na criação da reserva, e **devolvido uma única vez** na resposta.
- Enviado ao hóspede por e-mail, dentro do `linkAcompanhamento`.

### Verificação

```ts
export function tokenValido(informado: string | undefined, armazenado: string): boolean {
  if (!informado) return false;
  const a = Buffer.from(informado);
  const b = Buffer.from(armazenado);
  // timingSafeEqual LANÇA se os tamanhos diferirem — compare antes.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

| Regra | Motivo |
|---|---|
| Comparação em tempo constante | Comparação com `===` vaza o prefixo correto por tempo de resposta |
| Comparar tamanhos antes | `timingSafeEqual` lança `RangeError` com tamanhos diferentes — viraria `500` e um oráculo de tamanho |
| Token inválido → **`404`**, não `403` | `403` confirmaria que aquele `reservaId` existe |
| O token nunca aparece em log | Vai na querystring; o log estruturado **redige** o parâmetro `t` |
| O token não é renovável nem revogável individualmente | Simplicidade. Se um link vazar, o admin cancela a reserva ou o hóspede já concluiu a estadia |

### Por que na querystring e não em cabeçalho

O link precisa ser clicável num e-mail. Isso implica:

| Risco | Mitigação |
|---|---|
| Fica no log de acesso do servidor | Logs de acesso do CloudFront **desligados**; o log da Lambda redige `t` |
| Vai no `Referer` para terceiros | `Referrer-Policy: strict-origin-when-cross-origin`; a página não carrega recurso de terceiro |
| Fica no histórico do navegador | Aceito: é o navegador do próprio hóspede |
| Pode ser cacheado por intermediário | `Cache-Control: private, no-store` na rota + CloudFront com TTL 0 |

### Token iCal por casa

Mesmo mecanismo, escopo diferente: um token fixo por casa que autoriza o download do
`.ics`. Gerado na criação da casa, visível no backoffice (é o admin quem o cola no
Airbnb/Booking), e **rotacionável** por ação explícita.

Rotacionar invalida a URL cadastrada nos canais externos, então a tela avisa disso
antes de confirmar.

---

## Matriz de autorização

| Recurso | Anônimo | Hóspede com token | Admin |
|---|---|---|---|
| Lista e detalhe de casas **ativas** | ✅ | ✅ | ✅ |
| Casa em `RASCUNHO`/`INATIVA` | ❌ | ❌ | ✅ |
| Disponibilidade (só datas) | ✅ | ✅ | ✅ |
| Agenda com tipo e dono da ocupação | ❌ | ❌ | ✅ |
| Cotação | ✅ | ✅ | ✅ |
| Criar solicitação | ✅ | — | ✅ (manual) |
| Ver **a própria** reserva (dados mascarados) | ❌ | ✅ | ✅ |
| Ver qualquer reserva | ❌ | ❌ | ✅ |
| Cancelar a própria solicitação | ❌ | ✅ (só em `SOLICITADA`) | ✅ |
| Confirmar / recusar / estender | ❌ | ❌ | ✅ |
| Dados de pagamento e `motivoInterno` | ❌ | ❌ | ✅ |
| Preços, fotos, casas, bloqueios | ❌ | ❌ | ✅ |
| Templates de e-mail | ❌ | ❌ | ✅ |
| `.ics` da casa | ❌ (precisa do token iCal) | — | ✅ |
| Configuração geral completa | ❌ (só campos públicos) | ❌ | ✅ |

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | `/api/admin/*` sem `Authorization` | `401` |
| 2 | JWT expirado | `401` |
| 3 | JWT de outro User Pool | `401` |
| 4 | `idToken` em vez de `accessToken` | `401` (`token_use` errado) |
| 5 | JWT válido sem grupo `admin` | `403` |
| 6 | JWT com assinatura adulterada | `401` |
| 7 | Reserva sem `t` | `404` |
| 8 | Reserva com `t` errado do mesmo tamanho | `404` |
| 9 | Reserva com `t` de tamanho diferente | `404`, **sem** `500` |
| 10 | Token de uma reserva usado em outra | `404` |
| 11 | Requisição direta à Function URL sem `x-origem-cdn` | `403` |
| 12 | Log de uma requisição com `?t=...` | O log **não** contém o token |
| 13 | `.ics` com token de outra casa | `404` |
| 14 | Casa `RASCUNHO` em `GET /api/casas/{slug}` | `404` |
| 15 | Hóspede tenta cancelar reserva `CONFIRMADA` | `409 TRANSICAO_INVALIDA` |
