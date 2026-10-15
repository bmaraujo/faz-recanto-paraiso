# Casos de uso

Um documento por caso de uso. Cada um é **autocontido o suficiente para implementar**:
regra de negócio, contrato técnico, validações, erros e critérios de aceite.

## Convenção de formato

Todo UC segue esta estrutura:

```
# UC-X00 — Título

| Campo | Valor |
|---|---|
| Ator | quem executa |
| Pré-condições | o que precisa ser verdade antes |
| Gatilho | o que inicia |
| Fase | em qual fase do projeto entra |
| Documentos relacionados | links |

## Objetivo de negócio        por que isso existe, qual dor resolve
## Fluxo principal            passo a passo do caminho feliz
## Fluxos alternativos        variações legítimas
## Fluxos de exceção          o que dá errado e o que acontece
## Regras de negócio          RN1, RN2... numeradas e testáveis
## Contrato técnico           rota, entrada, saída, códigos de erro
## Implementação              o que escrever, onde, e as armadilhas
## Interface                  o que o usuário vê, estados de carregamento e erro
## Segurança e privacidade    o que proteger neste UC especificamente
## Critérios de aceite        checklist verificável
## Casos de teste             tabela de cenários
```

## Numeração

| Prefixo | Significa |
|---|---|
| `UC-P__` | Público (visitante ou hóspede) |
| `UC-A__` | Admin (backoffice) |

A numeração é **estável**: um UC removido não tem seu número reaproveitado.

## Índice

### Público

| ID | Título | Fase |
|---|---|---|
| [UC-P01](./publico/UC-P01-navegar-vitrine.md) | Navegar na vitrine das casas | 1 |
| [UC-P02](./publico/UC-P02-consultar-disponibilidade.md) | Consultar disponibilidade | 1 |
| [UC-P03](./publico/UC-P03-simular-preco.md) | Simular o preço da estadia | 1 |
| [UC-P04](./publico/UC-P04-solicitar-reserva.md) | Solicitar reserva | 2 |
| [UC-P05](./publico/UC-P05-acompanhar-solicitacao.md) | Acompanhar a solicitação | 2 |
| [UC-P06](./publico/UC-P06-cancelar-solicitacao.md) | Desistir da solicitação | 2 |
| [UC-P07](./publico/UC-P07-contato-direto.md) | Entrar em contato direto | 1 |
| [UC-P08](./publico/UC-P08-exportar-calendario-ical.md) | Exportar calendário iCal | 4 |

### Admin

| ID | Título | Fase |
|---|---|---|
| [UC-A01](./admin/UC-A01-autenticar.md) | Autenticar no backoffice | 1 |
| [UC-A02](./admin/UC-A02-gerenciar-casas.md) | Cadastrar e editar casas | 1 |
| [UC-A03](./admin/UC-A03-gerenciar-fotos.md) | Gerenciar fotos de uma casa | 1 |
| [UC-A04](./admin/UC-A04-gerenciar-precos.md) | Configurar preços de uma casa | 1 |
| [UC-A05](./admin/UC-A05-gerenciar-bloqueios.md) | Bloquear e liberar períodos | 1 |
| [UC-A06](./admin/UC-A06-ver-agenda.md) | Ver a agenda consolidada e o painel | 2 |
| [UC-A07](./admin/UC-A07-confirmar-reserva.md) | Confirmar uma reserva | 2 |
| [UC-A08](./admin/UC-A08-recusar-ou-cancelar-reserva.md) | Recusar ou cancelar uma reserva | 2 |
| [UC-A09](./admin/UC-A09-estender-prazo.md) | Estender o prazo de uma solicitação | 2 |
| [UC-A10](./admin/UC-A10-registrar-pagamento.md) | Registrar pagamento recebido fora do site | 3 |
| [UC-A11](./admin/UC-A11-criar-reserva-manual.md) | Criar reserva manual | 3 |
| [UC-A12](./admin/UC-A12-editar-templates-email.md) | Editar os textos dos e-mails | 3 |
| [UC-A13](./admin/UC-A13-configuracao-geral.md) | Ajustar a configuração geral | 2 |
| [UC-A14](./admin/UC-A14-publicar-site.md) | Publicar o conteúdo no site | 1 |
| [UC-A15](./admin/UC-A15-relatorio-ocupacao.md) | Consultar relatório de ocupação | 3 |
| [UC-A16](./admin/UC-A16-sincronizar-ical.md) | Sincronizar calendários externos | 4 |

## Casos de uso do sistema (sem ator humano)

Não têm documento próprio; estão descritos em
[01 — Arquitetura](../03-tecnico/01-arquitetura.md#cron-diario-de-hora-em-hora):

- Expirar solicitações vencidas
- Concluir reservas com check-out no passado
- Enviar e-mails agendados (`PRE_CHECKIN`, `POS_ESTADIA`, `PRAZO_EXPIRANDO_ADMIN`)
- Reenviar e-mails essenciais que falharam
- Importar calendários externos
