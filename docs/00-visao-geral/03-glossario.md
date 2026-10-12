# 03 — Glossário

Vocabulário único do projeto. **Use exatamente estes termos** em código, API, banco,
interface e conversa — evita a confusão clássica entre "reserva" e "solicitação".

| Termo | Definição |
|---|---|
| **Casa** | Uma unidade alugável da fazenda. Tem nome, slug, fotos, capacidade, comodidades, regras e **sua própria** tabela de preços e agenda. |
| **Slug** | Identificador legível da casa na URL (`casa-do-lago`). Único, imutável depois de publicado. |
| **Noite** | Unidade atômica de ocupação, identificada pela data em que o hóspede **dorme** (`YYYY-MM-DD`). Uma estadia de check-in dia 10 e check-out dia 12 ocupa as noites 10 e 11. |
| **Estadia** | O intervalo `[check-in, check-out)`. O check-out **não** é uma noite ocupada. |
| **Check-in / Check-out** | Datas de entrada e saída, sem hora no modelo de dados. Os horários ficam na configuração da casa e aparecem só nos textos. |
| **Reserva** | O registro de uma estadia, em qualquer estado do seu ciclo de vida. É a entidade. |
| **Solicitação** | Uma reserva no estado `SOLICITADA` — o hóspede pediu, o admin ainda não decidiu. |
| **Pré-reserva** | O efeito da solicitação: as noites ficam marcadas como ocupadas **pendentes**, com prazo de expiração. |
| **Prazo da solicitação** | Quanto tempo a pré-reserva segura as datas sem decisão do admin. Configurável, padrão **48 horas**. |
| **Confirmação** | Ato do administrador que transforma a solicitação em reserva firme. Ato humano, nunca automático. |
| **Bloqueio** | Período marcado como indisponível pelo administrador por motivo próprio (manutenção, uso da família). Não tem hóspede. |
| **Evento externo** | Noite ocupada importada do calendário iCal de um canal externo (Airbnb, Booking). |
| **Ocupação** | Item que marca uma noite de uma casa como tomada. Pode ser de tipo `RESERVA`, `BLOQUEIO` ou `EXTERNO`. |
| **Ocupação pendente** | Ocupação de tipo `RESERVA` cuja reserva está `SOLICITADA` e ainda dentro do prazo. Conta como ocupada para o público, mas é liberada na expiração. |
| **Cotação** | O cálculo detalhado do valor **estimado** da estadia. Sempre recalculada no servidor. |
| **Diária** | Valor de uma noite. Definido por precedência: feriado > temporada > fim de semana > base. |
| **Temporada** | Intervalo de datas com diária e mínimo de noites próprios (ex.: férias de julho). |
| **Feriado** | Intervalo curto com diária e mínimo de noites próprios, de maior precedência que temporada. |
| **Taxa de limpeza** | Valor fixo por estadia, cobrado uma vez, não por noite. Não recebe desconto. |
| **Hóspede extra** | Hóspede acima de `hospedesInclusos`. Gera acréscimo por noite. |
| **Situação de pagamento** | Controle **interno** do admin sobre o que recebeu fora do site: `NAO_REGISTRADO`, `PARCIAL`, `TOTAL`. Não é um estado da reserva. |
| **Token de acesso** | Segredo aleatório gerado por reserva. Sem ele, o `reservaId` não dá acesso a nada. |
| **Token iCal** | Segredo fixo por casa que autoriza o download do calendário `.ics`. |
| **Template de e-mail** | Assunto + corpo em Markdown com placeholders `{{variavel}}`, editável pelo admin. |
| **Publicação** | Ato de regerar o site estático com o conteúdo atual do banco e enviá-lo ao S3. |
| **Backoffice / Admin** | A SPA em `/admin`, protegida por Cognito, usada pelo único administrador. |

## Termos que NÃO usamos

| Evite | Use |
|---|---|
| "Booking", "booking" (como entidade) | Reserva |
| "Diária" para a estadia inteira | Diária = uma noite; a estadia tem `noites` |
| "Pedido", "orçamento" | Solicitação, cotação |
| "Sinal", "saldo", "pagamento aprovado" | Não existem — não há pagamento online |
| "Propriedade", "imóvel", "chalé", "unidade" | Casa |
| "Bloqueio" para pré-reserva | Pré-reserva é `pendente`; bloqueio é do admin |
