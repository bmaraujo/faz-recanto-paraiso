# 01 — Contexto e objetivos

## O negócio

O proprietário tem uma fazenda (Recanto Paraíso) com **uma ou mais casas** alugadas
por temporada: fins de semana, feriados e férias. A negociação hoje acontece por
WhatsApp e indicação. O proprietário também pode anunciar em Airbnb/Booking.

Volume esperado: **centenas de visitas/mês** e **poucas reservas/mês**.
**Um único administrador** opera o sistema.

## Para que serve o site

O site tem quatro funções, em ordem de importância:

1. **Vitrine** — mostrar as casas de forma profissional (fotos, comodidades,
   localização, regras) para quem chega por busca no Google ou por indicação.
2. **Disponibilidade** — mostrar quais datas estão livres em cada casa, evitando a
   ida e volta de mensagens só para descobrir que a data está ocupada.
3. **Controle de ocupação** — dar ao proprietário um lugar único que sabe quando
   cada casa está alugada, incluindo reservas fechadas por fora e bloqueios manuais.
4. **Ponte para o contato** — receber a solicitação do interessado, segurar as datas
   por um prazo e colocá-lo em contato com o administrador.

## O que o site explicitamente NÃO faz

**Não processa pagamentos.** Não há checkout, cartão, Pix, webhook de pagamento ou
estorno automático. O pagamento é combinado e recebido **fora do site** (Pix direto,
transferência, dinheiro), e o administrador registra no backoffice o que recebeu,
apenas para seu próprio controle.

Consequências diretas dessa escolha:

- A confirmação de uma reserva é um **ato humano** do administrador, não um evento
  automático de pagamento. Ver [ciclo de vida da reserva](../01-negocio/03-ciclo-de-vida-da-reserva.md).
- O site precisa de um mecanismo próprio para não deixar duas pessoas pedirem a
  mesma data: a **pré-reserva com prazo de expiração**
  ([ADR-010](../adr/ADR-010-pre-reserva-com-expiracao.md)).
- O valor mostrado no site é uma **estimativa**, e precisa ser comunicado como tal.
  O valor final é o que o administrador combinar.
- Some toda a complexidade de PCI, idempotência de pagamento, conciliação e estorno.
  O sistema fica muito mais simples, barato e seguro.

## Objetivos de qualidade (requisitos não funcionais)

| Objetivo | Meta | Como medimos |
|---|---|---|
| **Custo** | ≤ US$ 3/mês na AWS, excluindo domínio | AWS Cost Explorer + alerta do Budgets em US$ 5 |
| **Performance percebida** | Lighthouse ≥ 90 em Performance, Acessibilidade, SEO e Best Practices nas páginas públicas | Lighthouse CI no build |
| **Nunca travar o usuário** | Toda chamada externa com timeout; falha mostra erro claro e permite nova tentativa | Casos de teste de falha em cada UC |
| **Correção da ocupação** | Impossível haver duas reservas ativas na mesma noite da mesma casa | Teste de concorrência obrigatório |
| **Esforço operacional** | O administrador resolve tudo pelo backoffice, sem console AWS | Nenhum UC exige acesso ao console |
| **Privacidade** | Dados pessoais mínimos; nunca expostos em endpoints públicos | Revisão de cada endpoint público |

## Princípios de decisão

Quando houver dúvida entre duas soluções, a ordem de desempate é:

1. **Custo recorrente zero ou quase zero** vence.
2. **Menos peças móveis** vence (KISS).
3. **Não bloquear o usuário** vence conveniência de implementação.
4. **Correção dos dados de ocupação** vence qualquer otimização.
5. Só então: elegância, reuso, preferência pessoal.

## Restrições

- Nenhum serviço pago recorrente novo (EC2, Lightsail, RDS, NAT Gateway, ALB, WAF,
  Secrets Manager, API Gateway) sem aprovação explícita do proprietário.
- Região AWS: `us-east-1` — é a mais barata e o certificado ACM do CloudFront precisa
  estar lá. A latência é irrelevante porque o conteúdo é servido pelo CloudFront.
- Um único administrador. Não há papéis, permissões granulares nem multi-tenant.
- Dinheiro sempre em **centavos (inteiro)**. Datas de estadia sempre `YYYY-MM-DD`,
  fuso `America/Sao_Paulo`.
