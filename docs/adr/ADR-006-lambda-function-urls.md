# ADR-006 — Lambda Function URLs em vez de API Gateway

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | Mantido da especificação inicial |

## Contexto

O backend precisa expor HTTP para o site e para o backoffice, sob o mesmo domínio do
CloudFront (em `/api/*`), com custo mínimo.

Volume previsto: ~5.000 requisições/mês.

## Alternativas

| Opção | Custo | CORS | Prós | Contras |
|---|---|---|---|---|
| **Function URL** | **Grátis** | Não se aplica (mesmo domínio via CloudFront) | Sem custo, sem peça extra, sem CORS | Sem autorizador nativo útil; exposta na internet; sem throttling por rota |
| API Gateway HTTP API | ~US$ 1,00/milhão | Configurável | Autorizador JWT nativo, throttling, estágios | Custo (pequeno), uma peça a mais, mais uma configuração de IaC |
| API Gateway REST API | ~US$ 3,50/milhão | Configurável | Recursos avançados (WAF, chaves de API, cache) | Mais caro; complexidade desnecessária |
| ALB + Lambda | ~US$ 16/mês fixo | Configurável | — | **Custo fixo proibitivo** |
| Lambda@Edge | ~US$ 0,60/milhão + duração | — | Roda na borda | Mais caro; limitações de runtime |

## Decisão

**Lambda Function URL com `AuthType: NONE`**, atrás do CloudFront nos caminhos
`/api/*` e `/api/admin/*`. **Toda** autorização é feita dentro da Lambda.

### A pegadinha que determina o desenho

Seria natural usar **OAC** (Origin Access Control) do CloudFront na origem da Function
URL, para que só o CloudFront pudesse chamá-la. **Isso não funciona para `POST`.**

O OAC assina a requisição com SigV4, e para requisições com corpo o SigV4 exige o
cabeçalho `x-amz-content-sha256` com o hash do payload. Um navegador não envia isso.
Resultado: todo `POST` falha com `403`.

Existe a opção de o CloudFront usar `UNSIGNED-PAYLOAD`, mas a combinação específica
"OAC + Function URL + POST do navegador" é uma fonte conhecida de problemas. A
especificação inicial já alertava sobre isso, e o alerta está correto.

**Consequência adotada:** `AuthType: NONE`, sem OAC. A Function URL fica **diretamente
acessível na internet**, e por isso:

| Regra | Implicação |
|---|---|
| **Nenhum endpoint confia em "veio do CloudFront"** | A validação de JWT é *a* defesa, não um extra |
| `api-admin` valida o JWT em **toda** requisição, na primeira linha | Antes de qualquer `GetItem` |
| Rotas de reserva exigem token de 256 bits | Comparado com `timingSafeEqual` |
| Concorrência reservada baixa | Limita o dano de um ataque de volume |
| Cabeçalho `x-origem-cdn` com segredo do SSM | **Defesa em profundidade**, nunca autorização |

> O cabeçalho secreto merece destaque pelo que **não** é: o segredo pode vazar e
> qualquer um pode enviá-lo. Serve para obrigar o tráfego a passar pelo CloudFront
> (onde há cache e cabeçalhos de segurança) e para cortar varredura automatizada antes
> de gastar com validação de JWT. Tratá-lo como autorização seria um erro grave.

## Consequências

### Positivas
- Custo zero de exposição HTTP.
- Uma peça a menos na arquitetura.
- **Nenhum CORS**: tudo sob o mesmo domínio do CloudFront.
- Configuração mínima no CDK.
- Nenhum limite de payload artificial além do da própria Lambda.

### Negativas
- **A Function URL está na internet.** Toda a segurança depende do código da Lambda.
  Isso parece errado para quem revisa sem contexto — daí este ADR e um comentário no CDK.
- **Sem autorizador nativo.** A validação do JWT é código nosso (com `aws-jwt-verify`,
  a biblioteca oficial).
- **Sem throttling por rota.** Só concorrência reservada por função, que é um
  instrumento mais grosseiro.
- **Sem estágios.** A separação `dev`/`prod` é por função separada, não por estágio.
- **Sem integração nativa com WAF** na Function URL (o WAF ficaria no CloudFront, e
  não usamos WAF por custo).
- Roteamento interno (`/api/casas/{slug}` vs. `/api/casas/{id}/disponibilidade`) é
  feito **no código**, com um roteador próprio — não pelo API Gateway.

### O que fica mais difícil
- Rate limit por IP (exigiria WAF).
- Chaves de API para terceiros (não é requisito).
- Observabilidade de API pronta (métricas por rota viriam de graça no API Gateway;
  aqui saem do log).

## Mitigações

| Risco | Mitigação | Verificado por |
|---|---|---|
| Rota de admin sem autenticação | `exigirAdmin()` na primeira linha; revisão de checklist | [Checklist de segurança](../05-conformidade/01-seguranca.md#checklist-de-revisão-de-segurança) |
| Esquecer a validação em uma rota nova | O roteador exige que toda rota de `/admin/*` declare o guarda | Teste |
| Ataque de volume | Concorrência reservada (5 e 2) + cache do CloudFront | Alarme de `Throttles` |
| Varredura direta na Function URL | Cabeçalho `x-origem-cdn` | — |
| Custo por invocação | Free tier + concorrência reservada | Budgets |

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Necessidade de rate limit por IP | API Gateway HTTP API + WAF (~US$ 7/mês) |
| Volume > 1 milhão de requisições/mês | O custo do API Gateway passa a ser desprezível relativamente, e os recursos passam a valer |
| Terceiros consumindo a API | API Gateway com chaves e planos de uso |
| A AWS resolver a incompatibilidade OAC + POST | Adicionar OAC como defesa real, mantendo a validação na Lambda |
