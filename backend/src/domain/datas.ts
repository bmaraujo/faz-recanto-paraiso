/**
 * Reexporta a aritmética de datas de `@recanto/shared` — mesmo motivo de
 * `domain/disponibilidade.ts`: `handlers/` importa sempre de `../domain/*`, nunca
 * direto do pacote compartilhado.
 */
export { formatarInstanteIso, hojeEmSaoPaulo } from "@recanto/shared";
