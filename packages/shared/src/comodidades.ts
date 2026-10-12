/**
 * Lista fechada de comodidades que uma casa pode ter.
 *
 * Fica aqui, não no banco (docs/03-tecnico/02-modelo-de-dados.md, seção "Casa" —
 * "Comodidades"), para que ícone e tradução fiquem consistentes entre o backoffice
 * e o site sem uma ida ao banco. Valor fora desta lista é rejeitado na validação de
 * entrada (UC-A02, RN9).
 *
 * Extensível: adicionar um código aqui não migra dado nenhum, porque o atributo da
 * casa é só um array de strings. O rótulo em pt-BR de cada código (para exibição)
 * fica na camada de apresentação (`site/`), não aqui — este módulo é só a regra de
 * "quais códigos existem", não "como mostrá-los".
 */

import { z } from "zod";

export const COMODIDADES = [
  "WIFI",
  "PISCINA",
  "CHURRASQUEIRA",
  "LAREIRA",
  "AR_CONDICIONADO",
  "COZINHA_COMPLETA",
  "MAQUINA_LAVAR",
  "TV",
  "ESTACIONAMENTO",
  "ACEITA_PET",
  "LAGO",
  "TRILHA",
  "CAVALOS",
  "FOGAO_LENHA",
  "VARANDA",
  "ROUPA_DE_CAMA",
  "ACESSIVEL",
] as const;

export type ComodidadeCodigo = (typeof COMODIDADES)[number];

export const comodidadeSchema = z.enum(COMODIDADES);
