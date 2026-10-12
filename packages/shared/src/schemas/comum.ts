/**
 * Blocos de schema reaproveitados pelos schemas de cada entidade.
 *
 * Divisão de responsabilidade entre zod e `dominio/`, válida para todo este pacote:
 *
 * - **zod valida a forma da entrada** (tipo, formato, presença) — o que o contrato
 *   técnico chama de `ENTRADA_INVALIDA`, 400. É a mesma validação usada no servidor
 *   e no formulário do navegador (docs/03-tecnico/01-arquitetura.md).
 * - **as funções de `dominio/` validam a regra de negócio** (antecedência mínima,
 *   capacidade, mínimo de noites...) — os erros `422`/`409` específicos.
 *
 * `dataISOSchema` deliberadamente **não reimplementa** a verificação de calendário:
 * ela chama `ehDataValida`, a mesma função que `noitesDe` e `calcularCotacao` usam.
 * Ter dois lugares que decidem se "2026-02-30" é válido é como esse tipo de bug
 * nasce — ver docs/03-tecnico/14-estrategia-de-testes.md.
 */

import { z } from "zod";

import { type DataISO, ehDataValida } from "../dominio/datas";

/** Data de estadia `YYYY-MM-DD`, validada contra o calendário real. */
export const dataISOSchema: z.ZodType<DataISO> = z
  .string()
  .refine(ehDataValida, { message: "Data inválida. Use o formato AAAA-MM-DD." });

/**
 * Identificador ULID (26 caracteres, alfabeto de Crockford), usado para
 * `casaId`, `reservaId` e `bloqueioId` (docs/03-tecnico/02-modelo-de-dados.md).
 * Aceito em qualquer caixa; bibliotecas de ULID geram em maiúsculas por convenção.
 */
export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, { message: "Identificador inválido." });
