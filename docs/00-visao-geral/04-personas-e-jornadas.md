# 04 — Personas e jornadas

## Personas

### P1 — Interessado (visitante)
Família ou grupo de amigos procurando casa para um fim de semana ou feriado.
Chega por busca no Google, Instagram ou indicação. **Está no celular.**
Quer, em ordem: ver fotos, saber se a data dele está livre, saber quanto custa,
e falar com uma pessoa.

Dores que o site precisa resolver:
- Não conseguir ver as fotos direito no celular.
- Mandar mensagem e esperar horas para descobrir que a data está ocupada.
- Não saber o preço sem negociar.
- Não saber se o anúncio é confiável.

### P2 — Administrador (proprietário)
Uma pessoa, não técnica, usa o celular e às vezes o computador. Opera tudo.
Quer, em ordem: não perder reserva, não dar data em dobro, atualizar foto e preço
sozinho, e não ter trabalho repetitivo.

Dores:
- Controlar a agenda em caderno/planilha e errar.
- Reescrever a mesma mensagem de confirmação toda vez — por isso os
  [templates editáveis](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md).
- Depender de um desenvolvedor para mudar um preço ou uma foto.

### P3 — Canal externo (Airbnb / Booking)
Não é pessoa, é sistema. Consome o `.ics` exportado e fornece o `.ics` dele.
Relevante porque é a principal fonte de **overbooking** se a sincronização falhar.

## Jornada 1 — Interessado que reserva pelo site (caminho feliz)

```
Google/Instagram
   │
   ▼
/ (vitrine, lista de casas)              ─ UC-P01
   │  vê fotos, compara casas
   ▼
/casas/casa-do-lago                      ─ UC-P01
   │  galeria, comodidades, regras
   ▼
escolhe datas no calendário              ─ UC-P02
   │  (noites ocupadas já vêm marcadas)
   ▼
vê a estimativa de preço                 ─ UC-P03
   │  detalhada por noite + limpeza
   ▼
preenche nome, e-mail, telefone          ─ UC-P04
aceita regras  ►  "Solicitar reserva"
   │
   ├──► datas seguras por 48 h (pré-reserva)
   ├──► e-mail SOLICITACAO_RECEBIDA ao hóspede, com link de acompanhamento
   └──► e-mail NOVA_SOLICITACAO_ADMIN ao administrador
   ▼
tela "Solicitação recebida"              ─ UC-P05
   │  mostra prazo, resumo e botão de WhatsApp
   ▼
conversa no WhatsApp, paga por fora
   ▼
admin confirma no backoffice             ─ UC-A07
   │
   └──► e-mail RESERVA_CONFIRMADA ao hóspede
   ▼
D−3: e-mail PRE_CHECKIN (como chegar)
D+1 após check-out: e-mail POS_ESTADIA
```

## Jornada 2 — Interessado que prefere falar antes

```
/ ou /casas/<slug>  ►  botão flutuante de WhatsApp   ─ UC-P07
   │  mensagem pré-preenchida com a casa e as datas
   ▼
admin negocia e cria a reserva manual no backoffice  ─ UC-A11
   │
   └──► (opcional) e-mail RESERVA_CONFIRMADA
```

## Jornada 3 — Administrador no dia a dia

```
abre /admin  ►  login Cognito                        ─ UC-A01
   ▼
painel inicial
   ├─ solicitações pendentes, com prazo restante      ─ UC-A06
   ├─ próximos check-ins
   └─ alertas (conflito de iCal, falha de sync)
   ▼
decide cada solicitação
   ├─ confirmar                                       ─ UC-A07
   ├─ recusar                                         ─ UC-A08
   └─ estender prazo (ainda negociando)               ─ UC-A09
   ▼
registra o que recebeu por fora                       ─ UC-A10
   ▼
eventualmente: bloqueia um período                    ─ UC-A05
               ajusta preço de temporada              ─ UC-A04
               troca fotos                            ─ UC-A03
               edita o texto de um e-mail             ─ UC-A12
               publica o site                         ─ UC-A14
```

## Jornada 4 — O que não pode acontecer (anti-jornadas)

| Cenário | Mitigação | Onde está documentado |
|---|---|---|
| Duas pessoas solicitam a mesma noite ao mesmo tempo | `TransactWriteItems` com condição por noite; a segunda recebe `409 DATAS_INDISPONIVEIS` | [05 — Concorrência](../03-tecnico/05-concorrencia-e-idempotencia.md) |
| Hóspede solicita, desaparece, e a data fica travada para sempre | Prazo de expiração + `cron-diario` libera | [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) |
| Reserva fechada no Airbnb e também pelo site | Importação iCal a cada 30 min + alerta de conflito ao admin | [10 — iCal](../03-tecnico/10-sincronizacao-ical.md) |
| Hóspede recebe o mesmo e-mail duas vezes | `emailsEnviados[]` por reserva, verificado antes de cada envio | [06 — E-mails](../03-tecnico/06-emails-e-templates.md) |
| Admin edita o template e quebra todos os e-mails | Validação de placeholders na allowlist + pré-visualização + fallback para o padrão do código | [UC-A12](../02-casos-de-uso/admin/UC-A12-editar-templates-email.md) |
| Alguém descobre um `reservaId` e vê dados de outro hóspede | Token de acesso obrigatório, comparado com `timingSafeEqual` | [08 — Auth](../03-tecnico/08-autenticacao-e-autorizacao.md) |
| Robô enche o banco de solicitações | Honeypot, tempo mínimo de formulário, limite de 3 pendentes por e-mail, concorrência reservada | [UC-P04](../02-casos-de-uso/publico/UC-P04-solicitar-reserva.md) |
