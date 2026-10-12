/**
 * Reexporta a regra pura de disponibilidade de `@recanto/shared`.
 *
 * `packages/shared/src/dominio/` é o dono canônico das regras — o mesmo código
 * que o simulador no navegador usa (docs/03-tecnico/01-arquitetura.md). Este
 * arquivo existe só para que `handlers/` importe sempre de `../domain/*`, nunca
 * direto de `@recanto/shared`: é o que mantém `domain não importa lib` verificável
 * por uma única regra de lint, em vez de uma por módulo.
 */
export {
  ehErroConsultaDisponibilidade,
  listarNoitesOcupadas,
  noitesOcupadasEm,
  validarIntervaloConsulta,
  verificarDisponibilidade,
  type ErroConsultaDisponibilidade,
  type IntervaloConsulta,
  type OcupacaoNoite,
  type ResultadoDisponibilidade,
} from "@recanto/shared";
