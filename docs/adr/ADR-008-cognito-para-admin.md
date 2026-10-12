# ADR-008 — Cognito para autenticar o administrador

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | Mantido da especificação inicial |

## Contexto

Há **um** administrador. Ele acessa o backoffice do celular e do computador, de área
rural com sinal instável. Quem entra ali pode confirmar reservas, mudar preços, apagar
fotos e ler dados pessoais de todos os hóspedes.

Precisamos de autenticação segura, com recuperação de senha, sem custo recorrente e sem
escrever código de autenticação.

## Alternativas

| Opção | Custo | Esforço | Risco |
|---|---|---|---|
| **Cognito User Pool** | Grátis (50.000 MAU) | Baixo (Hosted UI) | **Baixo** — serviço gerenciado |
| Senha no SSM + JWT próprio | Grátis | **Médio-alto** | **Alto** — hash, rotação, expiração, recuperação, bloqueio, tudo escrito à mão |
| Basic Auth no CloudFront Function | Grátis | Baixo | **Alto** — senha no código da função; sem recuperação; sem MFA |
| Auth0 / Clerk | ~US$ 0-25 | Baixo | Baixo, mas é mais um fornecedor com dados |
| Chave de API única | Grátis | Muito baixo | **Alto** — vaza e não há como revogar sem redeploy |
| Google / GitHub OAuth direto | Grátis | Médio | Médio — vincula o acesso a uma conta de terceiro |

### Por que não autenticação própria

É tentador: uma senha, um hash, um JWT. Trinta linhas.

O que realmente é necessário para fazer bem: hash com custo adequado (`argon2` ou
`bcrypt` com fator correto), salt por usuário, política de senha, **rotação da chave de
assinatura do JWT**, expiração e renovação, revogação, recuperação de senha por e-mail
com token de uso único e prazo, bloqueio por tentativas, proteção contra timing attack
na comparação, e MFA se um dia for pedido.

Cada um desses é um lugar para errar, e errar aqui dá acesso total ao sistema. **Não é
onde o esforço deste projeto deve ir.**

## Decisão

**Cognito User Pool com Hosted UI (Managed Login)**, fluxo **Authorization Code +
PKCE**, JWT validado na Lambda com `aws-jwt-verify`.

| Configuração | Valor | Motivo |
|---|---|---|
| Login | E-mail | É o que ele lembra |
| Autorregistro | **Desabilitado** | Ninguém se cadastra; o usuário é criado por CLI |
| Grupo | `admin` | O JWT precisa conter `cognito:groups` com `admin` |
| Fluxo | **Code + PKCE (S256)** | Único aceitável para SPA; não expõe token na URL |
| `generateSecret` | **false** | SPA não guarda segredo |
| `accessToken` | 1 hora | — |
| `refreshToken` | **30 dias** | Evita login diário no celular com sinal ruim |
| Senha | Mín. 12 chars, maiúscula, minúscula, número, símbolo | — |
| MFA | **Opcional, TOTP, recomendado** `[DEFINIR]` | Decisão do proprietário; protege contra senha vazada |
| Advanced Security | Modo `AUDIT` | `ENFORCED` é pago; `AUDIT` é grátis e já registra tentativas |
| Tela de login | **Hosted UI** | Zero código de autenticação para manter |
| Armazenamento no cliente | `sessionStorage` | Não vai em requisição automática; morre ao fechar a aba |

### A decisão de usabilidade que importa

`refreshToken` de **30 dias** é deliberado. Um token de 1 dia seria "mais seguro" na
teoria e, na prática, faria o proprietário digitar uma senha de 12 caracteres no
celular, em 3G, toda vez que quisesse confirmar uma reserva. Sistema que irrita não é
usado — e um backoffice não usado significa agenda errada, que é o risco real do
projeto.

O contrapeso: `sessionStorage` (morre ao fechar a aba), CSP estrita (protege de XSS) e
MFA recomendado.

## Consequências

### Positivas
- **Zero código de autenticação** para escrever, testar e manter.
- Grátis no nosso volume (free tier de 50.000 usuários ativos/mês).
- Recuperação de senha, política de senha e bloqueio por tentativas: prontos.
- MFA disponível quando o proprietário quiser, sem código novo.
- `aws-jwt-verify` é oficial da AWS, sem dependência nativa, e faz cache do JWKS.
- Registro de tentativas de login (Advanced Security em `AUDIT`).
- Nenhuma senha passa pelo nosso código em momento algum.

### Negativas
- **A Hosted UI não combina com a identidade do site.** Customização limitada a
  logotipo e cores (Managed Login).
- **Um redirecionamento no login.** O usuário sai do site e volta.
- **Dependência do Cognito.** Se ele estiver fora, o admin não entra (o site público
  continua funcionando — o acoplamento é só no backoffice).
- **O User Pool é frágil a recriação.** Se o CDK recriar o pool, o usuário é perdido.
  Mitigado por `RemovalPolicy.RETAIN` e stack separada.
- **PKCE exige código no cliente** (gerar `code_verifier`, `state`, trocar o `code`) —
  ~80 linhas, mas é código de fluxo, não de criptografia.
- `sessionStorage` é acessível por JS, logo vulnerável a XSS. A defesa real é a CSP sem
  `script-src 'unsafe-inline'`.
- Conceitos do Cognito (User Pool vs. Identity Pool, `accessToken` vs. `idToken`) são
  confusos e geram erro — daí a validação explícita de `token_use: access`.

### O que fica mais difícil
- Login social (não é requisito).
- Múltiplos administradores com permissões diferentes (seria grupos no Cognito +
  autorização por grupo — extensível, mas não implementado).
- Testar o fluxo de login em ambiente local (mitigado: o E2E roda contra `dev`).

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Conta comprometida | Senha forte, MFA recomendado, Advanced Security em `AUDIT` |
| XSS roubando o token | CSP sem `unsafe-inline`; `<iframe sandbox>` na pré-visualização; nada de `innerHTML` com dado externo |
| CSRF | Não se aplica: autorização em cabeçalho, não em cookie |
| CSRF no fluxo de autorização | `state` aleatório, validado; divergência **aborta** sem trocar o `code` |
| Token na URL | Não acontece: Code + PKCE, nunca implicit |
| `idToken` usado como Bearer | `tokenUse: "access"` rejeita |
| Pool recriado | `RETAIN` + stack separada |
| Mensagem de erro vazando detalhe | O erro do verificador nunca é repassado ao cliente |

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Mais de um administrador com papéis distintos | Grupos no Cognito + autorização por grupo (extensão natural) |
| Necessidade de identidade visual na tela de login | Avaliar Managed Login avançado, ou tela própria com `InitiateAuth` (aumenta a superfície) |
| Custo do Cognito mudar | Improvável no free tier de 50.000 MAU |
| MFA passar a ser obrigatório por política | Mudar `mfa` para `REQUIRED` — uma linha no CDK |
