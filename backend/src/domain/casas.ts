/**
 * Reexporta as regras puras de Casa de `@recanto/shared` — mesmo motivo de
 * `domain/disponibilidade.ts`: `handlers/` importa sempre de `../domain/*`, nunca
 * direto do pacote compartilhado.
 */
export { ehEdicaoDeSlugPermitida } from "@recanto/shared";
