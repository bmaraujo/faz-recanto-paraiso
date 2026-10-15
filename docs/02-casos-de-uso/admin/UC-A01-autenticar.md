# UC-A01 — Autenticar no backoffice

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Usuário criado no Cognito User Pool e pertencente ao grupo `admin` |
| Gatilho | O admin acessa `/admin` sem sessão válida |
| Fase | 1 |
| Relacionados | [08 — Auth](../../03-tecnico/08-autenticacao-e-autorizacao.md), [12 — Infra](../../03-tecnico/12-infraestrutura-cdk.md) |

## Objetivo de negócio

Proteger o único ponto do sistema com poder destrutivo: quem entra no backoffice pode
confirmar reservas, mudar preços, apagar fotos e ler dados pessoais de todos os
hóspedes.

Requisito de usabilidade igualmente importante: o administrador acessa **do celular,
em área rural, com sinal instável**. Login que expira a cada hora e exige redigitar
senha no 3G faz ele parar de usar o sistema — e o sistema sem uso não serve para nada.

## Fluxo principal

1. O admin abre `/admin`.
2. A SPA verifica se há token válido no `sessionStorage`.
3. Não há → gera `code_verifier` e `state`, guarda-os, e redireciona para a Hosted UI
   do Cognito (fluxo Authorization Code + PKCE).
4. O admin digita e-mail e senha (e o código TOTP, se MFA estiver ativo).
5. O Cognito redireciona para `/admin/callback?code=...&state=...`.
6. A SPA **valida o `state`**, troca o `code` pelos tokens usando o `code_verifier`.
7. Guarda `accessToken` e `idToken` no `sessionStorage` e o `refreshToken` em memória.
8. Redireciona para a rota originalmente pedida (ou `/admin`).
9. Toda chamada a `/api/admin/*` envia `Authorization: Bearer <accessToken>`.

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Token ainda válido | Entra direto, sem passar pelo Cognito |
| A2 | `accessToken` expirado, `refreshToken` válido | Renova silenciosamente; o admin não percebe |
| A3 | Primeiro acesso (senha temporária) | A Hosted UI exige a troca de senha antes de emitir o token |
| A4 | Esqueci a senha | Fluxo de recuperação da própria Hosted UI, por e-mail |
| A5 | MFA ativo | A Hosted UI pede o código TOTP |
| A6 | Admin acessa uma rota profunda (`/admin/reservas/01HQ...`) | Após o login, volta **para aquela rota**, não para a home do admin |
| A7 | Logout | Limpa o `sessionStorage` e chama o endpoint de logout do Cognito |

> A6 importa mais do que parece: o admin clica no link de uma reserva pelo e-mail de
> `NOVA_SOLICITACAO_ADMIN`. Se o login o jogar na home, ele precisa procurar a reserva
> de novo — e é o fluxo mais frequente dele.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Senha errada | — | Mensagem da própria Hosted UI |
| E2 | Usuário sem grupo `admin` | `403` nas chamadas | "Sua conta não tem permissão para acessar o backoffice." + logout |
| E3 | `state` não confere no callback | — | "Não foi possível concluir o login." + botão para tentar novamente. **Não** troca o `code` |
| E4 | `code` inválido ou expirado | — | Mesma mensagem de E3 |
| E5 | `accessToken` e `refreshToken` expirados | `401` | Redireciona para o login preservando a rota |
| E6 | `401` em meio a uma ação | `401` | Tenta renovar; se falhar, avisa que a sessão expirou e **preserva o rascunho** do formulário |
| E7 | Cognito indisponível | — | "Não conseguimos acessar o serviço de login. Tente em alguns instantes." |
| E8 | Admin com duas abas abertas | — | Cada aba tem sua própria sessão (`sessionStorage` é por aba). Funciona, mas pode gerar `409` ao editar o mesmo recurso — tratado no frontend |

> **E3 é uma verificação de segurança, não um detalhe.** `state` divergente indica
> possível CSRF no fluxo de autorização. A regra é: **não troque o `code`** e
> comece de novo.
>
> **E6 é a razão do rascunho em `localStorage`.** Perder um texto de template longo
> porque o token expirou enquanto escrevia é inaceitável.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Somente usuários do grupo `admin` acessam `/api/admin/*` |
| RN2 | Autorregistro **desabilitado**; o usuário é criado por fora |
| RN3 | Senha com no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo |
| RN4 | Fluxo obrigatório: Authorization Code + PKCE. **Nunca** implicit grant |
| RN5 | `state` aleatório gerado e validado em todo login |
| RN6 | `accessToken` válido por 1 h; `refreshToken` por 30 dias |
| RN7 | Tokens no `sessionStorage` (morrem ao fechar a aba) |
| RN8 | O JWT é validado em **toda** requisição ao servidor, antes de qualquer leitura |
| RN9 | Validação de `iss`, `client_id`, `token_use: access`, `exp` e `cognito:groups` |
| RN10 | `/admin/*` com `noindex` e `Disallow` no `robots.txt` |
| RN11 | Nenhum segredo de cliente no navegador (`generateSecret: false`) |
| RN12 | Nenhum token aparece em log |

## Contrato técnico

### Endpoints do Cognito (Hosted UI)

```
GET  https://<dominio>.auth.sa-east-1.amazoncognito.com/oauth2/authorize
       ?response_type=code
       &client_id=<id>
       &redirect_uri=https://<site>/admin/callback
       &scope=openid+email
       &state=<aleatorio>
       &code_challenge=<S256 do verifier>
       &code_challenge_method=S256

POST https://<dominio>.auth.sa-east-1.amazoncognito.com/oauth2/token
       grant_type=authorization_code
       client_id=<id>
       code=<code>
       redirect_uri=https://<site>/admin/callback
       code_verifier=<verifier>

GET  .../logout?client_id=<id>&logout_uri=https://<site>/admin
```

### Validação no servidor

```ts
// lib/auth.ts — verificador criado FORA do handler (reaproveita o cache do JWKS)
const verificador = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId:   process.env.USER_POOL_CLIENT_ID!,
  tokenUse:   "access",
  groups:     ["admin"],
});

export async function exigirAdmin(evento: Evento): Promise<Identidade> {
  const cabecalho = evento.headers?.authorization ?? evento.headers?.Authorization;
  const token = cabecalho?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ErroHttp(401, "NAO_AUTENTICADO");
  try {
    const payload = await verificador.verify(token);
    return { sub: payload.sub, email: payload.email as string };
  } catch {
    throw new ErroHttp(401, "NAO_AUTENTICADO");   // nunca repassar a mensagem interna
  }
}
```

| Erro | HTTP |
|---|---|
| `NAO_AUTENTICADO` | 401 |
| `NAO_AUTORIZADO` (sem grupo) | 403 |

## Implementação

| Arquivo | O que faz |
|---|---|
| `site/src/lib/auth.ts` | PKCE, `state`, troca do code, renovação, logout |
| `site/src/pages/admin/[...rota].astro` | Shell da SPA |
| `site/src/components/admin/GuardaRota.tsx` | Verifica a sessão antes de renderizar |
| `backend/src/lib/auth.ts` | `exigirAdmin()` |

### Armadilhas

1. **Criar o `CognitoJwtVerifier` dentro do handler** faz cada invocação buscar o JWKS
   do Cognito — latência e chamada de rede desnecessárias a cada requisição.
   Crie no escopo do módulo.
2. **`verificador.verify()` é assíncrono** na primeira chamada (busca o JWKS).
   `await` obrigatório; esquecer resulta em uma Promise truthy que "autentica" todo mundo.
3. **`tokenUse: "access"`.** O `idToken` também é um JWT válido do mesmo pool, mas
   carrega os claims de identidade e não é feito para autorizar API.
4. **Nunca repassar a mensagem de erro do verificador** ao cliente: ela descreve
   qual validação falhou, o que ajuda quem está tentando forjar um token.
5. **PKCE com S256**, não `plain`. O `code_verifier` precisa ter 43–128 caracteres.
6. **Guardar o `state` e o `code_verifier`** no `sessionStorage` antes de redirecionar,
   e **apagá-los** depois do uso — reutilizar um `verifier` é falha de segurança.
7. **Renovar antes de expirar**, não depois do `401`: a cada chamada, se faltam menos
   de 5 min, renove primeiro. Isso evita o `401` no meio de uma ação.

## Interface

```
┌──────────────────────────────────────┐
│       Recanto Paraíso                │
│       Área administrativa            │
│                                       │
│   Verificando sua sessão...           │
│   [ ▓▓▓▓▓▓░░░░ ]                      │
└──────────────────────────────────────┘
```

| Estado | Comportamento |
|---|---|
| Verificando | Tela mínima com indicador; nunca a tela do backoffice sem dados |
| Redirecionando | "Levando você para o login..." |
| Callback | "Concluindo login..." |
| Erro de login | Mensagem + "Tentar novamente" |
| Sessão expirada em meio a uma ação | Faixa no topo: "Sua sessão expirou." + botão de entrar; **o rascunho é preservado** |
| Sem permissão | Mensagem clara + botão de sair |

A tela de login é a **própria Hosted UI** do Cognito. Não construímos tela de login:
é menos código, menos risco, e o Cognito já cuida de recuperação de senha, bloqueio
por tentativas e MFA.

Customização possível da Hosted UI: logotipo e cores, via Managed Login. `[DEFINIR]`

## Segurança e privacidade

| Item | Tratamento |
|---|---|
| Fluxo | Code + PKCE; nenhum token na URL |
| `state` | Validado; divergência aborta o fluxo |
| Armazenamento | `sessionStorage`; morre ao fechar a aba |
| XSS | A defesa real é a CSP estrita + nunca injetar HTML não sanitizado na SPA |
| CSRF | Não se aplica: a autorização vai em cabeçalho, não em cookie |
| Força bruta | Proteção do Cognito (Advanced Security em modo `AUDIT`) |
| MFA | Opcional, TOTP, **recomendado** `[DEFINIR]` |
| Senha | Nunca passa pelo nosso código; vai direto à Hosted UI |
| Log | Registra `sub` e e-mail mascarado do admin em ações de escrita; nunca o token |
| Function URL exposta | A validação do JWT é **a** defesa, não um extra |

## Critérios de aceite

- [ ] `/admin` sem sessão redireciona para a Hosted UI.
- [ ] Login válido devolve ao backoffice **na rota originalmente pedida**.
- [ ] `state` divergente aborta o login sem trocar o `code`.
- [ ] `accessToken` expirado com `refreshToken` válido renova sem interação.
- [ ] Ambos expirados redirecionam para o login preservando a rota.
- [ ] Sessão expirada em meio a um formulário preserva o rascunho.
- [ ] Toda rota `/api/admin/*` sem token válido retorna `401`.
- [ ] Usuário sem grupo `admin` recebe `403`.
- [ ] `idToken` usado como Bearer retorna `401`.
- [ ] JWT de outro User Pool retorna `401`.
- [ ] Nenhum token em log.
- [ ] `/admin/*` com `noindex` e `Disallow`.
- [ ] Nenhum segredo de cliente no bundle do navegador.
- [ ] Logout limpa a sessão local e encerra no Cognito.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Login completo | Acesso concedido |
| 2 | Senha errada | Erro na Hosted UI |
| 3 | `state` alterado no callback | Fluxo abortado, `code` não trocado |
| 4 | `code` reutilizado | Rejeitado pelo Cognito |
| 5 | Sem `Authorization` | `401` |
| 6 | JWT expirado | `401` |
| 7 | JWT de outro pool | `401` |
| 8 | `idToken` como Bearer | `401` |
| 9 | Assinatura adulterada | `401` |
| 10 | Usuário fora do grupo `admin` | `403` |
| 11 | `accessToken` a 2 min de expirar | Renovado antes da chamada |
| 12 | `refreshToken` expirado | Redireciona ao login |
| 13 | Deep link `/admin/reservas/01HQ...` sem sessão | Volta àquela rota após o login |
| 14 | Logout e voltar | Pede login novamente |
| 15 | Bundle do site | Nenhum segredo de cliente |
| 16 | Log de uma ação de escrita | Contém `sub`, nunca o token |
