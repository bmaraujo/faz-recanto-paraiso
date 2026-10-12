/**
 * Disponibilidade de uma casa: quais noites estão livres ou ocupadas.
 *
 * Ver docs/01-negocio/01-regras-de-disponibilidade.md e
 * docs/02-casos-de-uso/publico/UC-P02-consultar-disponibilidade.md.
 *
 * Este módulo responde "esta noite está livre?" e "este intervalo pode ser
 * reservado?". Ele **não** valida antecedência mínima, janela de reserva, mínimo de
 * noites ou capacidade — essas são regras de `precos.ts` (`calcularCotacao`), que a
 * cotação e a criação da solicitação já aplicam (UC-P04, RN5: "a cotação é sempre
 * recalculada no servidor"). Duplicar essa validação aqui divergiria com o tempo.
 *
 * Três decisões estruturais, na linha do resto do pacote:
 *
 * 1. **Puro.** `agora` entra por parâmetro; sem `Date.now()`, sem I/O, sem AWS SDK.
 * 2. **A fonte de ocupações é responsabilidade de quem chama.** Este módulo recebe a
 *    lista de registros já lida do banco (ou um `Set` de noites) e decide; ele nunca
 *    sabe de `DynamoDB`, `Query` ou chave de partição.
 * 3. **Pendência vencida é noite livre**, mesmo que o item ainda exista no banco
 *    (R4). O TTL do DynamoDB não é confiável para essa decisão — pode levar até
 *    ~48 h para remover o item — então a comparação acontece sempre, aqui, contra o
 *    instante atual.
 */

import {
  type DataISO,
  compararDatas,
  diferencaEmDias,
  ehDataValida,
  noitesDe,
  somarMeses,
} from "./datas";

// ---------------------------------------------------------------------------
// Ocupação de uma noite
// ---------------------------------------------------------------------------

export type TipoOcupacao = "RESERVA" | "BLOQUEIO" | "EXTERNO";

/**
 * O que este módulo precisa de um registro de ocupação de noite.
 *
 * Deliberadamente **não** inclui `refId`: o tipo de ocupação e a referência não
 * importam para decidir livre/ocupado, e omiti-los do tipo evita que um dia alguém
 * vaze esse campo numa resposta pública por estar "ali, disponível" (R11).
 */
export interface OcupacaoNoite {
  data: DataISO;
  /** `true` só enquanto a reserva que a criou está `SOLICITADA`. */
  pendente?: boolean;
  /** Instante em que a pendência vence. Presente se e somente se `pendente`. */
  expiraEm?: string;
}

/**
 * Uma ocupação **ativa** conta como ocupada; uma pendência vencida não (R4).
 *
 * Diferente do resto do pacote, aqui comparamos um **instante** (`expiraEm` é um
 * `ISO datetime` com hora), não um dia — por isso `Date`, e não as funções de dia de
 * `datas.ts`, é a ferramenta certa.
 */
export function ocupacaoEstaAtiva(
  ocupacao: Pick<OcupacaoNoite, "pendente" | "expiraEm">,
  agora: Date,
): boolean {
  if (ocupacao.pendente !== true) return true;
  if (ocupacao.expiraEm === undefined) return true; // dado inconsistente: trata como ativa
  return new Date(ocupacao.expiraEm).getTime() > agora.getTime();
}

/**
 * Conjunto de noites efetivamente ocupadas, já aplicando a regra de pendência
 * vencida. É o que decide a disponibilidade — nunca o tamanho da lista recebida.
 */
export function noitesOcupadasEm(ocupacoes: OcupacaoNoite[], agora: Date): Set<DataISO> {
  const ocupadas = new Set<DataISO>();
  for (const ocupacao of ocupacoes) {
    if (ocupacaoEstaAtiva(ocupacao, agora)) ocupadas.add(ocupacao.data);
  }
  return ocupadas;
}

/**
 * Noites ocupadas, ordenadas — a forma que `GET /api/casas/{id}/disponibilidade`
 * devolve (UC-P02). O tipo de retorno garante R11: **só** datas, nada mais.
 */
export function listarNoitesOcupadas(
  ocupacoes: OcupacaoNoite[],
  agora: Date,
): DataISO[] {
  return [...noitesOcupadasEm(ocupacoes, agora)].sort(compararDatas);
}

// ---------------------------------------------------------------------------
// Disponibilidade de uma estadia
// ---------------------------------------------------------------------------

export type ResultadoDisponibilidade =
  | { disponivel: true }
  | { disponivel: false; noitesIndisponiveis: DataISO[] };

/**
 * Verifica se `[checkin, checkout)` não colide com nenhuma noite ocupada.
 *
 * R6: o dia do check-out não precisa estar livre — só as noites da estadia, que é
 * exatamente o que `noitesDe` enumera. Aceita tanto um `Set` (já calculado por
 * `noitesOcupadasEm`) quanto um array, para servir tanto quem já tem o `Set` em mãos
 * quanto quem só tem a lista de datas.
 */
export function verificarDisponibilidade(
  ocupadas: ReadonlySet<DataISO> | readonly DataISO[],
  checkin: DataISO,
  checkout: DataISO,
): ResultadoDisponibilidade {
  const conjunto = ocupadas instanceof Set ? ocupadas : new Set(ocupadas);
  const noitesIndisponiveis = noitesDe(checkin, checkout).filter((noite) =>
    conjunto.has(noite),
  );

  return noitesIndisponiveis.length === 0
    ? { disponivel: true }
    : { disponivel: false, noitesIndisponiveis };
}

// ---------------------------------------------------------------------------
// Validação da consulta de disponibilidade (UC-P02)
// ---------------------------------------------------------------------------

/** RN7: acima disso, a consulta é rejeitada — protege o `Query` de varrer demais. */
export const MAX_MESES_CONSULTA_DISPONIBILIDADE = 13;

export type CodigoErroConsultaDisponibilidade =
  | "ENTRADA_INVALIDA"
  | "INTERVALO_MUITO_LONGO";

export interface ErroConsultaDisponibilidade {
  erro: CodigoErroConsultaDisponibilidade;
  mensagem: string;
  detalhes: Record<string, string | number>;
}

export interface IntervaloConsulta {
  de: DataISO;
  ate: DataISO;
}

export type ResultadoConsultaDisponibilidade =
  | IntervaloConsulta
  | ErroConsultaDisponibilidade;

/** Discrimina o resultado de `validarIntervaloConsulta`. */
export function ehErroConsultaDisponibilidade(
  resultado: ResultadoConsultaDisponibilidade,
): resultado is ErroConsultaDisponibilidade {
  return "erro" in resultado;
}

/**
 * Valida `de`/`ate` de `GET /api/casas/{id}/disponibilidade` (UC-P02).
 *
 * Mesma forma de erro-como-valor de `calcularCotacao`: uma consulta malformada é
 * fluxo esperado da rota pública, não falha do programa.
 */
export function validarIntervaloConsulta(
  de: unknown,
  ate: unknown,
): ResultadoConsultaDisponibilidade {
  if (!ehDataValida(de) || !ehDataValida(ate)) {
    return {
      erro: "ENTRADA_INVALIDA",
      mensagem: "As datas de consulta precisam estar no formato AAAA-MM-DD.",
      detalhes: { campo: ehDataValida(de) ? "ate" : "de" },
    };
  }

  if (compararDatas(ate, de) < 0) {
    return {
      erro: "ENTRADA_INVALIDA",
      mensagem: "A data final da consulta não pode vir antes da inicial.",
      detalhes: { de, ate },
    };
  }

  const limite = somarMeses(de, MAX_MESES_CONSULTA_DISPONIBILIDADE);
  if (compararDatas(ate, limite) > 0) {
    return {
      erro: "INTERVALO_MUITO_LONGO",
      mensagem: `A consulta não pode cobrir mais que ${MAX_MESES_CONSULTA_DISPONIBILIDADE} meses.`,
      detalhes: { maxMeses: MAX_MESES_CONSULTA_DISPONIBILIDADE, limite },
    };
  }

  return { de, ate };
}

// ---------------------------------------------------------------------------
// Agrupamento em períodos contíguos
// ---------------------------------------------------------------------------

/** Um intervalo `[inicio, fim]` de noites consecutivas, ambas as pontas inclusivas. */
export interface PeriodoContiguo {
  inicio: DataISO;
  fim: DataISO;
}

/**
 * Agrupa noites ocupadas em períodos contíguos: `["20","21","22","25"]` vira
 * `[{20,22}, {25,25}]`.
 *
 * Serve à agenda do backoffice (UC-A06) e à exportação iCal (Fase 4, R12): mostrar
 * "ocupado de 20 a 22" é o que o admin espera ver, não três linhas repetidas.
 * As datas de entrada não precisam estar ordenadas nem ser únicas.
 */
export function agruparNoitesContiguas(noites: readonly DataISO[]): PeriodoContiguo[] {
  const ordenadas = [...new Set(noites)].sort(compararDatas);
  const periodos: PeriodoContiguo[] = [];

  for (const noite of ordenadas) {
    const ultimo = periodos.at(-1);
    const continuaOUltimo = ultimo !== undefined && diferencaEmDias(ultimo.fim, noite) === 1;

    if (continuaOUltimo) {
      (ultimo as PeriodoContiguo).fim = noite;
    } else {
      periodos.push({ inicio: noite, fim: noite });
    }
  }

  return periodos;
}
