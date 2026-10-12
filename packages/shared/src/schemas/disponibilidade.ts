/**
 * Querystring de `GET /api/casas/{casaId}/disponibilidade` (UC-P02).
 *
 * Ver docs/02-casos-de-uso/publico/UC-P02-consultar-disponibilidade.md#contrato-técnico.
 * `de`/`ate` chegam como string na querystring, então este schema só garante o
 * formato `YYYY-MM-DD`. A ordem (`ate >= de`) e o limite de 13 meses são regra de
 * negócio e ficam em `validarIntervaloConsulta` (`dominio/disponibilidade.ts`), que
 * devolve o código específico (`ENTRADA_INVALIDA` ou `INTERVALO_MUITO_LONGO`).
 */

import { z } from "zod";

import { dataISOSchema } from "./comum";

export const consultaDisponibilidadeSchema = z.object({
  de: dataISOSchema,
  ate: dataISOSchema,
});

export type ConsultaDisponibilidade = z.infer<typeof consultaDisponibilidadeSchema>;
