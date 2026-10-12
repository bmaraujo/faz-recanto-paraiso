/**
 * Validação de forma da configuração de preços de uma casa (UC-A04).
 *
 * Mirror do tipo `ConfigPrecos` de `dominio/precos.ts` — os dois devem evoluir
 * juntos. Este schema checa **tipo e sinal** (é um inteiro? é ≥ 0?); os limiares de
 * negócio (diária base > 0, mínimo entre 1 e `maxNoites`, sobreposição de períodos...)
 * continuam exclusivamente em `validarConfigPrecos`, que já tem os testes dos 17
 * casos de docs/01-negocio/02-regras-de-preco.md. Duplicar o limiar aqui só criaria
 * uma segunda definição de "válido" para divergir da primeira.
 */

import { z } from "zod";

import { DIAS_DA_SEMANA } from "../dominio/datas";
import type { ConfigPrecos, PeriodoPreco } from "../dominio/precos";
import { dataISOSchema } from "./comum";

/** Centavos: inteiro, nunca negativo. Dinheiro em `float` não é aceito na fronteira. */
const centavosSchema = z.number().int().nonnegative();

export const diaDaSemanaSchema = z.enum(DIAS_DA_SEMANA);

export const periodoPrecoSchema: z.ZodType<PeriodoPreco> = z.object({
  id: z.string().min(1).max(100),
  nome: z.string().min(1).max(120),
  inicio: dataISOSchema,
  fim: dataISOSchema,
  diariaCentavos: centavosSchema,
  minNoites: z.number().int().positive(),
});

export const configPrecosSchema: z.ZodType<ConfigPrecos> = z.object({
  diariaBaseCentavos: centavosSchema,
  diariaFimDeSemanaCentavos: centavosSchema,
  diasFimDeSemana: z.array(diaDaSemanaSchema),
  temporadas: z.array(periodoPrecoSchema),
  feriados: z.array(periodoPrecoSchema),
  minNoitesPadrao: z.number().int().positive(),
  maxNoites: z.number().int().positive(),
  taxaLimpezaCentavos: centavosSchema,
  hospedesInclusos: z.number().int().positive(),
  capacidadeMaxima: z.number().int().positive(),
  valorHospedeExtraPorNoiteCentavos: centavosSchema,
});
