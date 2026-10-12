# ADR-011 — Dados em `sa-east-1`, certificado em `us-east-1`

| Status | **Aceito** |
|---|---|
| Data | 2026-10-12 |

## Contexto

A documentação nasceu assumindo `us-east-1` para tudo, por dois motivos: é a região
mais barata e o certificado ACM do CloudFront **tem** de estar lá. A pendência 8.4
deixou a escolha aberta, observando que custo e conformidade apontam para lados
diferentes.

Duas restrições delimitam a decisão:

- **LGPD.** Dados pessoais de hóspedes (nome, e-mail, telefone) fora do Brasil
  configuram transferência internacional (art. 33) e precisam ser declarados na
  política de privacidade.
- **ACM do CloudFront.** O certificado de um domínio próprio só é aceito se emitido em
  `us-east-1`. Essa restrição vale **apenas para o certificado** — foi onde a
  documentação original generalizou demais, levando a região inteira atrás dele.

No volume previsto (poucas dezenas de reservas por mês, base de poucos MB), a diferença
absoluta de custo entre as regiões é de **centavos**, não de dólares.

## Alternativas

| Alternativa | Trade-off |
|---|---|
| Tudo em `us-east-1` | Mais barata e com uma região só. Em troca, transferência internacional a declarar e justificar, pelo único motivo de economizar centavos. |
| **Dados em `sa-east-1`, certificado em `us-east-1`** | Dados pessoais no Brasil e art. 33 fora do caminho. Em troca, custo por serviço maior e uma segunda região na stack só para o certificado. |
| Tudo em `sa-east-1` | Impossível: o CloudFront recusaria o certificado. |

## Decisão

**DynamoDB, Lambda, SES, Cognito, SSM, EventBridge e S3 em `sa-east-1`.**
**Apenas o certificado ACM em `us-east-1`**, em stack separada, referenciada entre
regiões pelo CDK.

Decisão explícita do proprietário, não herança da estimativa de custo.

## Consequências

### Positivas

- Dados pessoais permanecem no Brasil. O art. 33 **não se aplica**, e a política de
  privacidade fica mais simples de escrever e de defender.
- Menor latência das rotas dinâmicas da API em relação à origem.

### Negativas

- **Custo por serviço ~20–40% maior.** No volume previsto a diferença absoluta fica em
  centavos e a meta de US$ 3/mês continua válida, mas as estimativas de
  [custos](../04-operacao/03-custos.md) foram feitas para `us-east-1` e precisam ser
  reconferidas na calculadora. Alguns free tiers são por região e não somam entre elas.
- **Uma peça móvel a mais:** a stack do frontend passa a depender de um recurso em outra
  região. Isso aparece no `cdk deploy` como duas stacks e exige referência entre regiões.
- **Obrigou a revisar a `priceClass` do CloudFront**, que havia sido escolhida como
  `PRICE_CLASS_100` (América do Norte e Europa) por custo. Com a origem em São Paulo,
  a classe 100 faria cada rota sem cache (`POST /api/cotacao`,
  `POST /api/solicitacoes` — TTL 0) sair do Brasil, ir a um edge nos EUA e **voltar**
  a São Paulo. Resolvido na mesma decisão: a distribuição passa a usar
  `PRICE_CLASS_ALL`, que inclui os edges de São Paulo. O egress por GB na América do
  Sul é mais caro, mas no volume previsto cabe no free tier do CloudFront, então a
  diferença esperada é US$ 0,00. Ver
  [12 — Infraestrutura](../03-tecnico/12-infraestrutura-cdk.md).

> A escolha da região e a da `priceClass` interagem, e foram tomadas em momentos
> diferentes — foi por isso que a segunda passou despercebida até aqui. O sistema
> atende **somente o Brasil**: origem, edges e dados ficam todos em São Paulo, e essa
> é a regra para qualquer decisão futura de localização.

## Quando revisar

- Se a fatura passar de US$ 3/mês de forma atribuível à região **ou** à classe de
  preço. O primeiro ajuste é comprimir as fotos, nunca servir do exterior.
- Se o negócio passar a atender público fora do Brasil — hoje não atende, e é a
  premissa que sustenta tanto a região quanto a classe de preço.
- Se algum serviço necessário não existir em `sa-east-1` — verificar na Fase 0, antes
  do primeiro `cdk deploy`.
