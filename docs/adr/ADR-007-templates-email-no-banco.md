# ADR-007 — Templates de e-mail no banco, editáveis pelo admin

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | **Diverge da especificação inicial** (que previa templates fixos no código) |
| **Decisor** | Proprietário |

## Contexto

A especificação inicial dizia: *"Templates em HTML simples + versão texto, em
português, gerados no código (sem serviço externo)"*.

O proprietário pediu explicitamente que **o texto do e-mail a ser enviado também possa
ser editado no backoffice**.

A motivação é legítima: o texto dos e-mails é a voz dele. Ele sabe o que precisa
explicar sobre a estrada, a chegada, o portão — e mudar uma frase não pode exigir um
deploy.

## Alternativas

| Opção | Autonomia | Risco | Esforço |
|---|---|---|---|
| **Markdown no banco, motor próprio sem lógica** | Alta | **Baixo** | Médio |
| Templates fixos no código | Nenhuma | Nenhum | Baixo |
| HTML livre no banco | Total | **Alto** (XSS, e-mail quebrado) | Baixo |
| Motor de template completo (Handlebars/Nunjucks/Liquid) | Alta | **Alto** (SSTI) | Baixo |
| Serviço externo (SendGrid, Mailchimp) | Alta | Médio | Baixo |

### Por que não um motor de template conhecido

Handlebars, Nunjucks, EJS e Liquid são excelentes — e **poderosos demais** para este
problema. Eles executam lógica: condicionais, laços, acesso a propriedades de objeto,
em alguns casos chamadas de função. Quando o template é escrito por um usuário e
renderizado no servidor, essa potência é a porta de entrada de **SSTI** (server-side
template injection), que leva a leitura de variáveis de ambiente e, em casos extremos,
execução de código.

Nosso requisito é: *substituir `{{nome}}` por um valor*. Isso são ~30 linhas de código.
Trazer um motor Turing-completo para fazer isso seria assumir uma classe inteira de
vulnerabilidade sem nenhuma necessidade.

### Por que não HTML livre

Seria mais simples de implementar e daria mais liberdade. Mas:
- Um `<script>` no e-mail é vetor de phishing a partir do nosso domínio.
- Um `<img src="http://rastreador">` transforma o e-mail em rastreador.
- Um HTML malformado quebra a renderização em alguns clientes de e-mail.
- E-mail exige HTML de 1999 (tabelas, CSS inline) — o admin não vai acertar.

### Por que não um serviço externo

Custo recorrente, mais um lugar com dados pessoais, mais uma dependência no caminho
crítico, e ainda assim o conteúdo dinâmico (datas, valores, links) precisaria vir de nós.

## Decisão

**Templates em Markdown no DynamoDB, com motor próprio sem lógica, padrão no código
como fallback.**

| Elemento | Decisão |
|---|---|
| Formato | Markdown + placeholders `{{nome}}` |
| Lógica no template | **Nenhuma.** Sem condicionais, laços, expressões ou acesso a objeto |
| Variáveis | **Allowlist por código de e-mail**, declarada no código |
| Variáveis obrigatórias | Validadas no salvamento, **com explicação do porquê** |
| Renderização | Escape para Markdown → converter para HTML → sanitizar com allowlist |
| HTML cru do admin | **Proibido** |
| Padrão | Arquivo `.md` no repositório, por código de e-mail |
| Fallback | Template inválido ou ausente → usa o padrão + `ALERTA_ADMIN` |
| Histórico | Últimas 10 versões, com restauração |
| Pré-visualização | Renderizada **no servidor**, exibida em `<iframe sandbox>` |
| Envio de teste | **Sempre** para o e-mail do admin cadastrado |

Detalhes em [06 — E-mails e templates](../03-tecnico/06-emails-e-templates.md) e
[UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md).

### As três decisões que fazem isso seguro

1. **Motor sem lógica** elimina SSTI por construção.
2. **Escape antes da substituição, sanitização depois da conversão** elimina XSS,
   inclusive quando o valor interpolado é o nome de um hóspede malicioso.
3. **Allowlist de variáveis declarada no código** torna **impossível** vazar um campo
   interno. `motivoInterno` não está em nenhuma allowlist — o impedimento é
   estrutural, não uma orientação.

### A decisão que faz isso não quebrar

**Os textos padrão ficam no repositório.** O banco guarda apenas o que o admin
personalizou. Consequências:

- O sistema funciona em uma conta nova, sem seed.
- Uma edição ruim nunca deixa o sistema sem comunicação.
- Um template inválido no banco faz o e-mail sair com o padrão e **alerta o admin** —
  em vez de falhar silenciosamente.

## Consequências

### Positivas
- **Autonomia total do proprietário** sobre a voz do negócio.
- Nenhum deploy para mudar texto.
- `PRE_CHECKIN` personalizado é um ganho operacional real: é o texto que ele hoje
  escreve à mão em cada reserva.
- Histórico com restauração protege de erro.
- Pré-visualização e envio de teste reduzem o medo de editar.
- Variáveis obrigatórias garantem que informação crítica (prazo, aviso de "não é
  reserva") nunca desapareça.

### Negativas
- **Mais código a escrever e testar** que templates fixos: motor, validação,
  sugestão de variável, histórico, pré-visualização, envio de teste. ~30 casos de teste.
- **Superfície de segurança nova.** Mesmo com todas as mitigações, é texto do usuário
  renderizado e enviado. Exige revisão cuidadosa.
- **O admin pode piorar os textos.** Nada impede um e-mail confuso — só garante que
  não seja perigoso nem incompleto.
- **Markdown tem curva de aprendizado** (pequena, mas existe). Mitigado pela
  pré-visualização ao vivo.
- Uma leitura a mais do banco por e-mail enviado (com cache, irrelevante).
- Divergência possível entre o padrão do código e o personalizado do banco, se uma
  variável for removida do código — tratado pelo fallback + alerta.

### O que fica mais difícil
- Mudar o nome de uma variável: exige migração ou aceitar que templates personalizados
  caiam no fallback (com alerta). Por isso a allowlist deve ser tratada como **contrato
  estável**.
- Testar todos os caminhos de renderização (daí os 16 casos em
  [06 — E-mails](../03-tecnico/06-emails-e-templates.md)).

## Riscos aceitos

| Risco | Severidade | Mitigação | Residual |
|---|---|---|---|
| SSTI | Crítica | Motor sem lógica | **Muito baixo** |
| XSS no e-mail | Alta | Escape + sanitização com allowlist | Baixo |
| XSS no backoffice (pré-visualização) | Alta | `<iframe sandbox>` sem `allow-scripts` | Baixo |
| Relay de spam | Média | Destinatário fixo + limite de 10/h | Baixo |
| Vazamento de dado interno | Média | Allowlist no código | **Muito baixo** |
| E-mail essencial quebrado | Média | Variáveis obrigatórias + fallback + alerta | Baixo |
| Rastreador em e-mail | Baixa | `<img>` externo bloqueado | Muito baixo |

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| O admin nunca usar o recurso | Simplificar: voltar a templates fixos e economizar manutenção |
| Pedido por lógica no template ("mostrar X só se Y") | **Resistir.** A resposta correta é um novo código de e-mail, não lógica no template |
| Pedido por imagens no e-mail | Anexo `cid:` com allowlist de imagens enviadas pelo admin — não `<img>` externo |
| Vulnerabilidade descoberta no renderizador de Markdown | Atualizar; a sanitização é a segunda camada |
