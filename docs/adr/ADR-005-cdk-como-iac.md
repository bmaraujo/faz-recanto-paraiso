# ADR-005 — AWS CDK como IaC

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Diverge da especificação inicial** (que previa AWS SAM) |
| **Decisor** | Proprietário/desenvolvedor |

## Contexto

Todo recurso deve ser provisionado por código, em dois stages (`dev` e `prod`).

A especificação inicial previa **AWS SAM** (`template.yaml`). O desenvolvedor já usa
**AWS CDK (TypeScript)** nos outros projetos do workspace (`Tado`, `EcommerceAWS`) e
preferiu manter a consistência.

## Alternativas

| Opção | Linguagem | Prós | Contras |
|---|---|---|---|
| **AWS CDK (TypeScript)** | TypeScript | Tipagem, abstrações de alto nível, mesma linguagem do backend, `NodejsFunction` já faz o bundle, testes com `assertions` | Camada de síntese; `cdk diff` menos legível que um YAML; versão do CDK é dependência |
| AWS SAM | YAML | Simples para Lambda+API, `sam local` para testar offline | Abstrações limitadas fora de serverless; YAML não tem tipagem; menos natural para CloudFront e Cognito |
| Terraform | HCL | Multi-cloud, estado explícito, comunidade grande | Mais uma linguagem; estado remoto para gerenciar; não é nativo da AWS |
| Pulumi | TypeScript | Semelhante ao CDK, multi-cloud | Serviço de estado (pago no plano de equipe) |
| CloudFormation puro | YAML/JSON | Zero abstração | Verborrágico ao extremo; 1.500+ linhas para esta arquitetura |
| Console AWS | — | Rápido para experimentar | **Não reproduzível** — inaceitável |

## Decisão

**AWS CDK v2, em TypeScript.**

Razões, em ordem de peso:

1. **Consistência com o workspace.** Os outros projetos usam CDK. Uma ferramenta a
   menos para manter na cabeça vale mais que qualquer vantagem marginal.
2. **Mesma linguagem do backend.** Tipos compartilhados entre `packages/shared`,
   `backend/` e `infra/` — o nome da tabela e as variáveis de ambiente não divergem
   por erro de digitação.
3. **O projeto não é só serverless.** Há CloudFront com 5 comportamentos, uma
   CloudFront Function, OAC, Cognito com Hosted UI, EventBridge Scheduler, SNS,
   Budgets e policies de IAM por prefixo. Em SAM, isso cai em `Resources` de
   CloudFormation puro — perdendo a vantagem do SAM.
4. **`NodejsFunction`** roda o esbuild e empacota sem nenhuma configuração extra.
5. **Testes de infraestrutura** com `aws-cdk-lib/assertions`: é o que permite falhar o
   build quando alguém adiciona `Action: "*"` ou um NAT Gateway
   ([12 — Infra](../03-tecnico/12-infraestrutura-cdk.md#testes-de-infraestrutura)).

O ponto 5 é o que mais pesa na prática: **as garantias de custo e de privilégio mínimo
deste projeto são testes de CDK.** Em YAML, seriam convenções sujeitas a revisão manual.

## Consequências

### Positivas
- Uma única linguagem no projeto inteiro.
- Tipagem pega erro de configuração em tempo de compilação.
- Abstrações de alto nível (`Distribution`, `UserPool`, `Table`) reduzem muito o código.
- Constructs próprios eliminam repetição (`LambdaNode` padroniza runtime, arquitetura,
  log e bundle das 5 funções).
- Testes de infraestrutura protegem custo, segurança e cache.
- `cdk diff` antes de cada deploy.
- Divisão em 5 stacks com dependências resolvidas automaticamente.

### Negativas
- **`cdk diff` é menos legível** que comparar dois YAMLs. Exige atenção para perceber
  um `Replacement: true`.
- **Atualizar a versão do CDK** pode mudar o template gerado sem mudança no código —
  daí o teste de snapshot.
- **Abstrações escondem detalhes.** Um `Distribution` com defaults gera comportamento
  que precisa ser conferido (por isso as políticas de cache são explícitas e testadas).
- **Sem `sam local`.** Testar Lambda offline exige outro caminho: testes de integração
  com DynamoDB Local, que é o que fazemos de qualquer forma.
- Build mais lento que ler um YAML.
- `cdk bootstrap` é um pré-requisito na conta.

### O que fica mais difícil
- Entender exatamente o que será criado sem ler o template sintetizado
  (`cdk synth`). Mitigado pelo teste de snapshot.
- Onboarding de quem conhece Terraform mas não CDK.

## Mitigações

| Risco | Mitigação |
|---|---|
| `cdk diff` esconder uma destruição | Lista de sinais de alerta no [deploy](../04-operacao/01-ambientes-e-deploy.md#sinais-de-alerta-no-cdk-diff) |
| Atualização do CDK mudar o template | Teste de snapshot |
| Default de abstração indesejado | Políticas de cache, IAM e retenção **explícitas** e testadas |
| `cdk destroy` acidental | `RemovalPolicy.RETAIN` + deletion protection na tabela de `prod` |
| Deploy no stage errado | `--context stage=` obrigatório, sem padrão |
| Deploy ampliando IAM sem revisão | `--require-approval broadening` em `prod` |

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Necessidade de multi-cloud | Terraform ou Pulumi |
| Equipe que já usa Terraform entrar no projeto | Avaliar a migração |
| CDK gerar template instável entre versões | Fixar a versão e avaliar |

Nenhum desses gatilhos é previsível. A decisão é estável.
