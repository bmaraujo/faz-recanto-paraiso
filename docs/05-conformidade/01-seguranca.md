# 01 — Segurança

Modelo de ameaças e controles. Escrito para ser **verificável**, não aspiracional:
cada controle aponta para onde está implementado e testado.

## Superfície de ataque

```
                              INTERNET
    ┌──────────────┬──────────────┬──────────────┬──────────────┐
    │              │              │              │              │
    ▼              ▼              ▼              ▼              ▼
CloudFront    Function URL    Function URL    Hosted UI     URL do .ics
(público)     api-publica     api-admin       Cognito       (com token)
              (AuthType NONE) (AuthType NONE)
    │              │              │              │              │
    └──────────────┴──────────────┴──────────────┴──────────────┘
                              │
                   ┌──────────┴──────────┐
                   ▼                      ▼
             DynamoDB                   S3
          (só via Lambda)         (só via CloudFront/OAC
                                   + api-admin em midia/*)
```

Pontos expostos e o que os protege:

| Ponto | Autenticação | Controle principal |
|---|---|---|
| Site estático | nenhuma | Conteúdo público por natureza |
| `/api/*` (pública) | nenhuma | Validação de entrada, antiabuso, concorrência reservada |
| `/api/admin/*` | **JWT Cognito** | Validado em toda requisição, antes de qualquer leitura |
| `/api/solicitacoes/{id}` | **token de acesso** | 256 bits, comparação em tempo constante |
| `.ics` | **token iCal** | 256 bits por casa; conteúdo sem dado pessoal |
| Hosted UI | senha (+ TOTP) | Serviço gerenciado |
| Function URLs | **nenhuma** (`AuthType: NONE`) | Toda autorização é na Lambda |

> A Function URL com `AuthType: NONE` é a decisão que mais exige atenção: ela está
> diretamente na internet, sem o CloudFront na frente. Toda autorização acontece
> **dentro** da Lambda. O motivo é a incompatibilidade entre OAC do CloudFront e `POST`
> em Function URL ([ADR-006](../adr/ADR-006-lambda-function-urls.md)). A consequência é
> que **nenhum endpoint pode confiar em "veio do CloudFront"**.

## Modelo de ameaças

| # | Ameaça | Impacto | Probabilidade | Mitigação |
|---|---|---|---|---|
| T1 | Enumerar reservas e ler dados de hóspedes | **Alto** (LGPD) | Média | Token de 256 bits; `404` uniforme; ULID não sequencial |
| T2 | Criar reservas em massa (bot) | Médio (datas travadas) | Média | Honeypot, tempo de formulário, limite por e-mail, concorrência reservada |
| T3 | Overbooking por corrida | **Alto** | Baixa | Transação condicional ([05 — Concorrência](../03-tecnico/05-concorrencia-e-idempotencia.md)) |
| T4 | Comprometer a conta do admin | **Crítico** | Baixa | Senha forte, MFA recomendado, Advanced Security em `AUDIT` |
| T5 | XSS no backoffice | **Alto** (rouba o token) | Baixa | CSP estrita; pré-visualização em `<iframe sandbox>`; nada de `innerHTML` com dado externo |
| T6 | Injeção no template de e-mail | Médio (phishing) | Baixa | Motor sem lógica; escape + sanitização ([06 — E-mails](../03-tecnico/06-emails-e-templates.md)) |
| T7 | SSRF pela URL do iCal | **Alto** (credenciais do ambiente) | Baixa | `https` obrigatório; bloqueio de IP privado e metadados |
| T8 | Upload de arquivo malicioso | Médio | Baixa | Allowlist de tipo + **magic number**; SVG proibido; `nosniff` |
| T9 | Esgotamento de custo | Médio | Média | Concorrência reservada; Budgets; teste de infraestrutura |
| T10 | Cache do CloudFront vazando dado pessoal | **Crítico** | Baixa | TTL 0 + `no-store` em `/api/solicitacoes/*`, verificado por teste |
| T11 | Vazamento por log | Médio (LGPD) | **Média** | Wrapper de log obrigatório com mascaramento; `no-console` no lint |
| T12 | Injeção de iframe pelo campo de mapa | Médio | Baixa | Allowlist de host; só `https:` |
| T13 | Injeção de comando no pipeline | **Alto** | Baixa | `client_payload` nunca em shell; `stage` em allowlist |
| T14 | Perda de dados por `cdk destroy` | **Crítico** | Baixa | `RETAIN` + deletion protection em `prod` |
| T15 | Perda de fotos por `s3 sync --delete` | **Alto** | **Média** | `--exclude "midia/*"` + teste de deploy |
| T16 | Relay de spam pelo envio de teste | Médio | Baixa | Destinatário fixo (e-mail do admin) + limite de 10/h |

As de **probabilidade média** (T2, T9, T11, T15) são as que merecem mais atenção na
revisão de código — não as de maior impacto, que já têm controles estruturais.

## Controles por categoria

### Validação de entrada

| Regra | Onde |
|---|---|
| Toda entrada validada com **zod**, no servidor | Todo handler |
| Tamanho do corpo verificado **antes** do parse | `lib/http.ts` |
| Limites por rota (16 KB a 128 KB) | [04 — API admin](../03-tecnico/04-api-admin.md) |
| Nenhum valor monetário aceito do cliente | [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) |
| Nenhum campo de texto livre aceita HTML | zod + sanitização |
| Enums validados contra listas fechadas | `packages/shared` |
| Datas como `YYYY-MM-DD`, nunca `Date` do cliente | `domain/datas.ts` |

**Injeção de SQL não se aplica:** o DynamoDB é acessado pelo SDK com parâmetros
tipados, nunca por concatenação de string. Não há SQL no projeto.

### Autenticação e autorização

Detalhado em [08 — Auth](../03-tecnico/08-autenticacao-e-autorizacao.md).

| Controle | Valor |
|---|---|
| Admin | JWT Cognito, grupo `admin`, validado em toda requisição |
| Verificações do JWT | assinatura, `iss`, `client_id`, `token_use: access`, `exp`, grupo |
| Fluxo | Authorization Code + PKCE (S256). **Nunca** implicit |
| Hóspede | Token de 256 bits por reserva |
| Comparação de token | `timingSafeEqual`, com verificação de tamanho antes |
| Token inválido | **`404`**, nunca `403` |
| Posição da verificação | **Primeira linha** do handler, antes de qualquer `GetItem` |

### Privilégio mínimo (IAM)

| Regra | Verificação |
|---|---|
| Nenhum `Action: "*"` | `infra/test/seguranca.test.ts` |
| Nenhum `Resource: "*"` em DynamoDB/S3 | idem |
| **`dynamodb:Scan` não concedido a ninguém** | idem |
| `dynamodb:DeleteTable` nunca concedido | idem |
| `api-admin` escreve no S3 só em `midia/casas/*` | idem |
| `publicar-conteudo` escreve só em `_dados/*` | idem |
| `ses:SendEmail` condicionado ao remetente configurado | idem |
| `lambda:InvokeFunction` só nas funções específicas | idem |

> Testar as policies é muito mais confiável que revisá-las: o teste falha o build, a
> revisão depende de alguém notar.

### Cabeçalhos de segurança

Response Headers Policy do CloudFront, em **todas** as respostas:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

### Content Security Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://*.auth.sa-east-1.amazoncognito.com;
frame-src https://www.openstreetmap.org https://www.google.com;
frame-ancestors 'none';
form-action 'self' https://*.auth.sa-east-1.amazoncognito.com;
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

| Diretiva | Por quê |
|---|---|
| `script-src 'self'` **sem** `unsafe-inline` | A defesa mais efetiva contra XSS. Exige que o Astro não gere script inline — verificar no build |
| `style-src` com `unsafe-inline` | O Astro gera estilo inline; é um risco muito menor que script |
| `img-src 'self' data:` | `data:` para ícones SVG embutidos |
| `connect-src` com o Cognito | Troca do code pelo token |
| `frame-src` com allowlist | Apenas o iframe do mapa |
| `frame-ancestors 'none'` | Impede clickjacking |
| `object-src 'none'` | Nenhum plugin |

> `script-src 'self'` sem `unsafe-inline` é o item mais importante desta lista, porque
> é o que protege o token do admin no `sessionStorage` (T5). Se o build gerar script
> inline, **corrija o build**, não relaxe a CSP.

### Proteção de dados em trânsito e em repouso

| Camada | Controle |
|---|---|
| Em trânsito | HTTPS obrigatório; HSTS com preload; `upgrade-insecure-requests` |
| S3 | Bucket policy com `Deny` para `aws:SecureTransport: false` |
| S3 | SSE-S3 (grátis) |
| DynamoDB | Criptografia gerenciada pela AWS (padrão) |
| SSM | `SecureString` para todo segredo |
| Backups | PITR criptografado |
| Chamadas externas | Só `https:`, com timeout |

### Segredos

| Segredo | Onde | Rotação |
|---|---|---|
| Segredo de origem do CloudFront | SSM SecureString | Anual |
| Token do GitHub | SSM SecureString | Anual |
| Segredo do callback de publicação | SSM SecureString | Anual |
| URLs de iCal | SSM SecureString | Quando o canal mudar |
| Senha do admin | **Cognito** — nunca no nosso sistema | A critério do admin |
| Tokens de acesso de reserva | Gerados e guardados no item da reserva | Não rotacionáveis (por desenho) |
| Token iCal por casa | Item da casa | Sob demanda, pelo admin |

**Nada no repositório.** Verificado por: `.gitignore` com `.env*`, e um hook de
pre-commit opcional com detecção de segredo.

### Antiabuso

| Controle | Detalhe |
|---|---|
| Honeypot | Campo oculto; preenchido → `201` falso, nada gravado |
| Tempo de formulário | `< 3000 ms` → `201` falso |
| Limite por e-mail | 3 solicitações pendentes (hash do e-mail, não o e-mail) |
| Concorrência reservada | Teto absoluto de processamento |
| Cache do CloudFront | Absorve leitura repetida |
| Limite de payload | Por rota |
| Limite de intervalo | 13 meses na disponibilidade; 3 meses na agenda |

**Sem rate limit por IP:** exigiria WAF (~US$ 6/mês). Os controles acima cobrem o
volume esperado. Gatilho de revisão em [custos](../04-operacao/03-custos.md).

### Logs

Detalhado em [13 — Observabilidade](../03-tecnico/13-observabilidade.md).

| Nunca em log | Mascaramento |
|---|---|
| E-mail completo | `ma***@exemplo.com` |
| Telefone completo | `+55119****9999` |
| Nome completo | omitido |
| Valores financeiros com pessoa identificável | omitidos |
| `tokenAcesso`, `tokenIcal`, parâmetro `t` | `[REDIGIDO]` |
| JWT, cabeçalho `Authorization` | nunca logado |
| Corpo de e-mail renderizado | só o código e o `messageId` |
| URL de iCal | só o canal |

Imposto por: wrapper obrigatório em `lib/log.ts` + regra de lint `no-console`.

## Revisão de segurança por caso de uso

| UC | Risco principal | Controle que o cobre |
|---|---|---|
| [UC-P01](../02-casos-de-uso/publico/UC-P01-navegar-vitrine.md) | Expor o endereço exato | `enderecoPublico` separado de `enderecoCompleto` |
| [UC-P02](../02-casos-de-uso/publico/UC-P02-consultar-disponibilidade.md) | Vazar dados pela disponibilidade | Resposta só com datas; `ProjectionExpression` restrita |
| [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) | Spam; XSS pela observação | Antiabuso; escape no backoffice e no e-mail |
| [UC-P05](../02-casos-de-uso/publico/UC-P05-acompanhar-solicitacao.md) | Enumeração; cache vazando | `404` uniforme; `no-store` + TTL 0 |
| [UC-P08](../02-casos-de-uso/publico/UC-P08-exportar-calendario-ical.md) | Dados do hóspede em serviço de terceiro | `SUMMARY` fixo; só datas |
| [UC-A01](../02-casos-de-uso/admin/UC-A01-autenticar.md) | Conta comprometida | PKCE; MFA; `state` validado |
| [UC-A02](../02-casos-de-uso/admin/UC-A02-gerenciar-casas.md) | Injeção de iframe | Allowlist de host do mapa |
| [UC-A03](../02-casos-de-uso/admin/UC-A03-gerenciar-fotos.md) | Upload malicioso | Magic number; presigned POST com limite; SVG proibido |
| [UC-A10](../02-casos-de-uso/admin/UC-A10-registrar-pagamento.md) | Armazenar CPF/cartão | Detecção de padrão sensível na entrada |
| [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) | SSTI; relay de spam | Motor sem lógica; teste só para o admin |
| [UC-A14](../02-casos-de-uso/admin/UC-A14-publicar-site.md) | Perda de fotos; injeção no pipeline | `--exclude`; `client_payload` validado |
| [UC-A16](../02-casos-de-uso/admin/UC-A16-sincronizar-ical.md) | **SSRF** | `https` + bloqueio de IP privado antes de cada download |

## Checklist de revisão de segurança

Rodar antes de cada deploy em produção, e a cada mudança em handler ou IAM:

### Autenticação e autorização
- [ ] Toda rota `/api/admin/*` chama `exigirAdmin()` na **primeira** linha
- [ ] Nenhuma rota de admin faz `GetItem` antes de autenticar
- [ ] Toda rota de reserva valida o token com `timingSafeEqual`
- [ ] Token inválido retorna `404`, nunca `403` nem `500`
- [ ] Nenhum endpoint confia em "veio do CloudFront"

### Validação
- [ ] Todo handler valida com zod antes de acessar o banco
- [ ] Tamanho do corpo verificado antes do parse
- [ ] Nenhum valor monetário vem do cliente
- [ ] Nenhum campo livre aceita HTML
- [ ] URLs de entrada (mapa, iCal) passam por allowlist

### Dados
- [ ] Nenhuma resposta pública contém dado pessoal (exceto a própria reserva com token)
- [ ] `pagamento`, `motivoInterno`, `enderecoCompleto` e `tokenIcal` ausentes das respostas públicas
- [ ] Os JSONs publicados usam **allowlist** de campos
- [ ] `/api/solicitacoes/*` com TTL 0 e `no-store`

### Infraestrutura
- [ ] `infra/test/seguranca.test.ts` passando
- [ ] `infra/test/cache.test.ts` passando
- [ ] `infra/test/custo.test.ts` passando
- [ ] Nenhum `Action: "*"`; nenhum `dynamodb:Scan`
- [ ] Bucket sem acesso público; `enforceSSL`
- [ ] Tabela de `prod` com `RETAIN`, PITR e deletion protection

### Segredos e logs
- [ ] Nenhum segredo no repositório
- [ ] Todo segredo em SSM `SecureString`
- [ ] Nenhum `console.log` fora de `lib/log.ts`
- [ ] Log sem e-mail, telefone, nome, valores ou token

### Cabeçalhos
- [ ] CSP sem `script-src 'unsafe-inline'`
- [ ] HSTS, `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`
- [ ] Nenhum script de terceiro no site público

## O que não fazemos, e por quê

| Controle | Por que não |
|---|---|
| AWS WAF | ~US$ 6/mês; o antiabuso na aplicação cobre o volume esperado. Gatilho de revisão documentado |
| GuardDuty | ~US$ 4/mês mínimo; sem recursos de rede para monitorar |
| AWS Config | Custo por regra; o teste de CDK cobre o mesmo em tempo de build |
| Pentest profissional | Custo alto para o porte. A revisão de código + checklist é o substituto proporcional |
| MFA obrigatório | Decisão do proprietário `[DEFINIR]` — **recomendado**. Opcional por padrão para não travar o acesso dele |
| Rotação automática de segredos | Exigiria Secrets Manager; rotação anual manual está no runbook |
| Versionamento do bucket S3 | Custo de armazenamento; o conteúdo é regenerável e as fotos estão referenciadas no banco. **Compensado** pelo `--exclude` + teste |

> Esta última linha é uma fragilidade assumida: sem versionamento, um `s3 sync --delete`
> mal escrito apaga as fotos de forma irrecuperável. A compensação é o `--exclude`
> obrigatório, o comentário no script e o teste de deploy. Se o proprietário preferir,
> ligar o versionamento custa ~US$ 0,01/mês nesse volume e remove o risco — **vale
> reconsiderar**.
