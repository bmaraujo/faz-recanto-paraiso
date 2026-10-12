/**
 * Corpo de `POST /api/cotacao` (UC-P03).
 *
 * Ver docs/02-casos-de-uso/publico/UC-P03-simular-preco.md#contrato-técnico. Este
 * schema valida a **forma** da requisição; `calcularCotacao` (`dominio/precos.ts`)
 * valida as regras de negócio sobre os mesmos campos — incluindo o que aqui parece
 * redundante, como `checkout > checkin`, porque ali o erro precisa do código
 * específico (`INTERVALO_INVALIDO`) e da mensagem amigável, não só da rejeição.
 *
 * `hospedes` aceita qualquer inteiro positivo aqui; o teto real é a capacidade da
 * casa, que só se conhece depois de carregá-la do banco — por isso é
 * `CAPACIDADE_EXCEDIDA` do domínio, não deste schema.
 */

import { z } from "zod";

import { dataISOSchema, ulidSchema } from "./comum";

export const entradaCotacaoPublicaSchema = z.object({
  casaId: ulidSchema,
  checkin: dataISOSchema,
  checkout: dataISOSchema,
  hospedes: z.number().int().positive(),
});

export type EntradaCotacaoPublica = z.infer<typeof entradaCotacaoPublicaSchema>;
