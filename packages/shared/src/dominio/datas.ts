/**
 * Aritmetica de datas de estadia.
 *
 * Este modulo e a base de todo o resto do sistema: preco, disponibilidade, iCal e
 * e-mails dependem dele. Erros de data sao os mais sorrateiros do projeto, por isso
 * tres decisoes sao explicitas aqui:
 *
 * 1. Uma data de estadia e uma string `YYYY-MM-DD`, nunca um `Date`. `Date` carrega
 *    hora e fuso, e os dois sao fonte de bug quando so interessa o dia.
 * 2. Toda a aritmetica roda em UTC, sobre o dia. Fuso horario entra em um unico
 *    ponto: `hojeEmSaoPaulo`, que traduz um instante real para o dia local.
 * 3. Nada de I/O e nada de `Date.now()`. O instante atual sempre entra por parametro,
 *    o que mantem o modulo puro e os testes deterministicos.
 *
 * Tres convencoes de intervalo coexistem no sistema, e confundi-las desloca tudo em
 * um dia. Cada uma tem sua propria funcao, de proposito:
 *
 * | Convencao                       | Funcao                        | 10 a 15 da |
 * |---------------------------------|-------------------------------|------------|
 * | Estadia `[checkin, checkout)`   | `noitesDe`                    | 5 noites   |
 * | Bloqueio/temporada `[ini, fim]` | `noitesDePeriodoInclusivo`    | 6 noites   |
 * | `DTEND` do iCal (exclusivo)     | `dtEndDeCheckout`             | = checkout |
 *
 * Ver docs/01-negocio/01-regras-de-disponibilidade.md (R1) e
 * docs/00-visao-geral/03-glossario.md.
 */

/** Fuso de referencia para tudo que envolve "hoje". */
export const FUSO_HORARIO = "America/Sao_Paulo";

/**
 * Data de estadia no formato `YYYY-MM-DD`.
 *
 * E um alias de `string`, nao um tipo nominal: o ganho real vem de validar na
 * fronteira (`validarData`) e nao de enganar o compilador.
 */
export type DataISO = string;

/** Dias da semana na ordem do `getUTCDay` (0 = domingo). */
export const DIAS_DA_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"] as const;

export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

const NOME_DO_DIA: Record<DiaDaSemana, string> = {
  DOM: "Domingo",
  SEG: "Segunda-feira",
  TER: "Terca-feira",
  QUA: "Quarta-feira",
  QUI: "Quinta-feira",
  SEX: "Sexta-feira",
  SAB: "Sabado",
};

const FORMATO_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

/** Limite tecnico do intervalo que o sistema aceita manipular, em dias. */
const MAX_DIAS_POR_INTERVALO = 400;

/** Data `YYYY-MM-DD` ausente, malformada ou inexistente no calendario. */
export class DataInvalidaError extends Error {
  readonly codigo = "DATA_INVALIDA";
  readonly campo: string;

  constructor(valor: unknown, campo = "data") {
    super(`${campo}: "${String(valor)}" nao e uma data valida no formato YYYY-MM-DD`);
    this.name = "DataInvalidaError";
    this.campo = campo;
  }
}

/** Intervalo em que o fim vem antes do inicio. */
export class IntervaloInvalidoError extends Error {
  readonly codigo = "INTERVALO_INVALIDO";

  constructor(inicio: DataISO, fim: DataISO) {
    super(`intervalo invalido: "${fim}" vem antes de "${inicio}"`);
    this.name = "IntervaloInvalidoError";
  }
}

/**
 * Verifica se o valor e uma data `YYYY-MM-DD` que existe no calendario.
 *
 * Rejeita `2026-02-30` em vez de aceitar e virar 01/03 silenciosamente, que e o
 * comportamento do construtor `Date`.
 */
export function ehDataValida(valor: unknown): valor is DataISO {
  if (typeof valor !== "string") return false;

  const partes = FORMATO_DATA_ISO.exec(valor);
  if (partes === null) return false;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;

  // Ida e volta pelo UTC: se o dia nao existe no mes, o Date normaliza e os
  // componentes deixam de casar.
  const instante = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia
  );
}

/** Valida e devolve a data, ou lanca `DataInvalidaError`. Use na fronteira. */
export function validarData(valor: unknown, campo = "data"): DataISO {
  if (!ehDataValida(valor)) throw new DataInvalidaError(valor, campo);
  return valor;
}

/** Converte uma data validada em epoch (ms) da meia-noite UTC daquele dia. */
function paraEpoch(data: DataISO, campo = "data"): number {
  const partes = FORMATO_DATA_ISO.exec(validarData(data, campo));
  // `validarData` garante o casamento; o non-null aqui e so para o compilador.
  const [, ano, mes, dia] = partes as RegExpExecArray;
  return Date.UTC(Number(ano), Number(mes) - 1, Number(dia));
}

/** Converte epoch (ms) de volta para `YYYY-MM-DD`. */
function paraDataISO(epoch: number): DataISO {
  return new Date(epoch).toISOString().slice(0, 10);
}

/** Soma (ou subtrai, com valor negativo) dias a uma data. */
export function somarDias(data: DataISO, dias: number): DataISO {
  if (!Number.isInteger(dias)) {
    throw new TypeError(`dias deve ser inteiro, recebido: ${String(dias)}`);
  }
  return paraDataISO(paraEpoch(data) + dias * MS_POR_DIA);
}

/**
 * Soma (ou subtrai) meses de calendario a uma data.
 *
 * Usado na janela de reserva ("hoje + 12 meses"). Quando o dia nao existe no mes
 * destino, trunca para o ultimo dia dele: `2026-01-31 + 1 mes` = `2026-02-28`.
 * Truncar e o que o usuario espera de "um mes depois"; estourar para 03/03 nao e.
 */
export function somarMeses(data: DataISO, meses: number): DataISO {
  if (!Number.isInteger(meses)) {
    throw new TypeError(`meses deve ser inteiro, recebido: ${String(meses)}`);
  }

  const instante = new Date(paraEpoch(data));
  const ano = instante.getUTCFullYear();
  const mes = instante.getUTCMonth();
  const dia = instante.getUTCDate();

  const alvo = new Date(Date.UTC(ano, mes + meses, 1));
  // Dia 0 do mes seguinte = ultimo dia do mes alvo.
  const ultimoDiaDoMesAlvo = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
  ).getUTCDate();

  return paraDataISO(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(dia, ultimoDiaDoMesAlvo)),
  );
}

/**
 * Numero de dias de `de` ate `ate`. Negativo se `ate` vier antes.
 *
 * Imune a horario de verao porque conta sobre a meia-noite UTC de cada dia, nao
 * sobre a duracao real do dia local. O Brasil nao usa horario de verao hoje, mas
 * ja usou e pode voltar a usar.
 */
export function diferencaEmDias(de: DataISO, ate: DataISO): number {
  return Math.round((paraEpoch(ate, "ate") - paraEpoch(de, "de")) / MS_POR_DIA);
}

/** Compara duas datas: -1, 0 ou 1. Serve para `sort`. */
export function compararDatas(a: DataISO, b: DataISO): -1 | 0 | 1 {
  const diferenca = paraEpoch(a, "a") - paraEpoch(b, "b");
  if (diferenca < 0) return -1;
  if (diferenca > 0) return 1;
  return 0;
}

/**
 * Noites ocupadas por uma estadia: `[checkin, checkout)`.
 *
 * O dia do check-out **nao** e ocupado — e o que permite a troca de hospede no mesmo
 * dia (R1). Check-in igual a check-out devolve lista vazia; check-out antes do
 * check-in lanca erro, porque e sempre bug de quem chamou.
 */
export function noitesDe(checkin: DataISO, checkout: DataISO): DataISO[] {
  const dias = diferencaEmDias(
    validarData(checkin, "checkin"),
    validarData(checkout, "checkout"),
  );
  if (dias < 0) throw new IntervaloInvalidoError(checkin, checkout);
  return gerarDias(checkin, dias);
}

/**
 * Noites de um periodo com inicio e fim **inclusivos**.
 *
 * Convencao de bloqueio, temporada e feriado: "do dia 29 ao dia 2" inclui as duas
 * pontas, porque e assim que o administrador pensa.
 */
export function noitesDePeriodoInclusivo(inicio: DataISO, fim: DataISO): DataISO[] {
  const dias = diferencaEmDias(validarData(inicio, "inicio"), validarData(fim, "fim"));
  if (dias < 0) throw new IntervaloInvalidoError(inicio, fim);
  return gerarDias(inicio, dias + 1);
}

function gerarDias(inicio: DataISO, quantidade: number): DataISO[] {
  if (quantidade > MAX_DIAS_POR_INTERVALO) {
    throw new RangeError(
      `intervalo de ${quantidade} dias excede o limite tecnico de ${MAX_DIAS_POR_INTERVALO}`,
    );
  }

  const base = paraEpoch(inicio);
  const dias: DataISO[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    dias.push(paraDataISO(base + i * MS_POR_DIA));
  }
  return dias;
}

/**
 * `DTEND` do `VEVENT` que representa uma estadia.
 *
 * O iCal usa fim **exclusivo** em eventos de dia inteiro, a mesma convencao do
 * check-out — logo o valor e o proprio check-out. A funcao existe para que o
 * ponto de uso declare qual convencao esta aplicando: a identidade aqui e o
 * resultado da regra, nao coincidencia.
 */
export function dtEndDeCheckout(checkout: DataISO): DataISO {
  return validarData(checkout, "checkout");
}

/** Dia da semana da data, no codigo usado por `diasFimDeSemana`. */
export function diaDaSemana(data: DataISO): DiaDaSemana {
  const indice = new Date(paraEpoch(data)).getUTCDay();
  return DIAS_DA_SEMANA[indice] as DiaDaSemana;
}

/** Nome do dia da semana em pt-BR, como aparece no detalhamento da cotacao. */
export function nomeDoDiaDaSemana(data: DataISO): string {
  return NOME_DO_DIA[diaDaSemana(data)];
}

/** `true` se a data esta em `[inicio, fim]`, com as duas pontas inclusivas. */
export function estaNoIntervaloInclusivo(
  data: DataISO,
  inicio: DataISO,
  fim: DataISO,
): boolean {
  const alvo = paraEpoch(data);
  return alvo >= paraEpoch(inicio, "inicio") && alvo <= paraEpoch(fim, "fim");
}

const FORMATADOR_DIA_LOCAL = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_HORARIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * O dia corrente em `America/Sao_Paulo` para um instante real.
 *
 * Unico ponto do modulo que conhece fuso. Em UTC as 02:30 ja e o dia seguinte no
 * Brasil, e usar a data de UTC desloca toda a disponibilidade em um dia perto da
 * meia-noite. O instante entra por parametro para manter a funcao pura.
 */
export function hojeEmSaoPaulo(agora: Date): DataISO {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new TypeError("agora deve ser um Date valido");
  }

  const partes: Record<string, string | undefined> = Object.fromEntries(
    FORMATADOR_DIA_LOCAL.formatToParts(agora).map((parte) => [parte.type, parte.value]),
  );

  // Valida a montagem em vez de assumir que o Intl devolveu as tres partes: se a
  // plataforma mudar o formato, falha aqui e nao em uma data errada la na frente.
  return validarData(`${partes.year}-${partes.month}-${partes.day}`, "hoje");
}

/** Formata `2026-11-20` como `20/11/2026`. */
export function formatarDataPtBr(data: DataISO): string {
  const [ano, mes, dia] = validarData(data).split("-");
  return `${dia}/${mes}/${ano}`;
}
