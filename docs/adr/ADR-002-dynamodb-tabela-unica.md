# ADR-002 — DynamoDB em tabela única

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | Mantido da especificação inicial |

## Contexto

Precisamos persistir casas, preços, reservas, ocupações de noite, bloqueios, templates
de e-mail e configuração. O volume é pequeno (< 1 MB/ano), os padrões de acesso são
**conhecidos e poucos**, e a garantia mais importante do sistema é a **ausência de
dupla reserva** — que exige escrita atômica e condicional sobre múltiplos itens.

## Alternativas

| Opção | Custo/mês | Atomicidade | Prós | Contras |
|---|---|---|---|---|
| **DynamoDB tabela única** | ~US$ 0,02 | `TransactWriteItems` | Free tier, transação ACID, escrita condicional, sem servidor | Modelagem rígida; consulta ad-hoc difícil |
| DynamoDB multi-tabela | ~US$ 0,02 | Transação **entre** tabelas também funciona | Modelo mais "intuitivo" | Mais recursos; consultas que juntam dados exigem N chamadas |
| RDS PostgreSQL `t4g.micro` | ~US$ 12-15 | `BEGIN/COMMIT` | SQL, consulta ad-hoc, `UNIQUE` constraint | **Custo 15× a meta**; precisa de VPC → NAT (+US$ 32) ou RDS Proxy |
| Aurora Serverless v2 | ~US$ 43 mínimo | SQL | Escala | Custo proibitivo nesse porte |
| SQLite em EFS/S3 | ~US$ 0,10 | Frágil com Lambda concorrente | Barato | **Sem garantia de atomicidade entre invocações** — inaceitável |

## Decisão

**DynamoDB on-demand, tabela única**, com `PK`/`SK` e um GSI.

A razão decisiva **não é o custo** — é a `TransactWriteItems` com
`ConditionExpression` por item. Ela permite expressar, em uma operação atômica:

> "Crie esta reserva **e** ocupe estas N noites, mas **somente se** cada uma delas
> estiver livre ou com pendência vencida."

Essa é exatamente a garantia que o negócio precisa, imposta pelo banco e não por
código. Em SQL, o equivalente seria uma transação com `INSERT ... ON CONFLICT` ou um
índice único por `(casa, data)` — igualmente correto, mas a 15× o custo e com uma VPC
no caminho.

Modelo completo em [02 — Modelo de dados](../03-tecnico/02-modelo-de-dados.md).

### A chave que carrega a decisão

```
PK = OCUPACAO#<casaId>    SK = NOITE#<YYYY-MM-DD>
```

Permite tanto a leitura de um intervalo com uma única `Query` (o calendário) quanto a
escrita condicional por noite (a garantia). As duas operações mais importantes do
sistema, atendidas pela mesma chave.

## Consequências

### Positivas
- Cabe no free tier; custo de centavos.
- **Atomicidade real** na operação crítica.
- Nenhum servidor, patch, backup manual ou pool de conexão.
- Latência de um dígito de milissegundo.
- Sem VPC → sem NAT Gateway (US$ 32/mês economizados).
- PITR por centavos.

### Negativas
- **Modelagem rígida.** Um padrão de acesso novo pode exigir um item de índice ou um GSI.
- **Nenhuma consulta ad-hoc.** Perguntas não previstas exigem código.
- `Scan` é proibido (e a permissão não é concedida) — o que é bom, mas significa que
  **todo** padrão de acesso precisa ser pensado antes.
- A busca textual (nome, e-mail) é feita **na Lambda**, não no banco. Aceitável em
  centenas de reservas; não escala para dezenas de milhares.
- O relatório por data de criação lê uma janela ampla e filtra em memória
  ([UC-A15](../02-casos-de-uso/admin/UC-A15-relatorio-ocupacao.md)).
- Limite de 100 itens por transação → estadia máxima de 60 noites.
- A curva de aprendizado de tabela única é real para quem vem de SQL.

### O que fica mais difícil
- Relatórios analíticos complexos (resolvido: os que existem são simples e agregados).
- Mudança de modelo depois de ter dados (exige migração escrita à mão).
- Depuração manual (o console do DynamoDB é pior que um `psql`).

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| > 5.000 reservas/ano | Adicionar `GSI2` por status e por data de criação |
| > 30 casas | Item agregado de agenda por mês |
| Necessidade de BI / consulta ad-hoc | Exportar para S3 + Athena (barato), **não** migrar para SQL |
| Busca textual lenta | Repensar; provavelmente ainda não justifica OpenSearch (caro) |
| Demanda real por estadias > 60 noites | Mudar a granularidade da ocupação, **não** fatiar a transação |
