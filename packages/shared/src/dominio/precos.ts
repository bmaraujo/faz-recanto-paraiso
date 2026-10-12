/**
 * Cotação da estadia: a mesma função roda no servidor e no navegador.
 *
 * Ver docs/01-negocio/02-regras-de-preco.md e
 * docs/02-casos-de-uso/publico/UC-P03-simular-preco.md.
 *
 * Quatro decisões estruturais:
 *
 * 1. **Dinheiro é centavos inteiros.** Nenhum `float` em nenhum ponto do caminho, e
 *    nenhum arredondamento no meio da conta — não há percentual na cotação pública.
 * 2. **Erro de validação é valor de retorno, não exceção.** Noites abaixo do mínimo e
 *    capacidade excedida são fluxo esperado da tela, não falha do programa. Quem chama
 *    discrimina com `ehErroCotacao`.
 * 3. **A função é pura.** `hoje` entra por parâmetro; sem `Date.now()`, sem I/O.
 * 4. **O detalhamento faz parte do resultado.** O hóspede precisa ver de onde saiu o
 *    total, e a soma das linhas é sempre igual a `totalCentavos` — a invariante que
 *    protege este módulo de qualquer refatoração futura.
 *
 * O navegador usar esta função é conveniência de UX, e **não** dispensa o recálculo no
 * servidor: o servidor executa com a configuração que ele lê do banco, nunca com
 * valores recebidos na requisição.
 */

import {
  DIAS_DA_SEMANA,
  type DataISO,
  type DiaDaSemana,
  compararDatas,
  diaDaSemana,
  diferencaEmDias,
  ehDataValida,
  noitesDe,
  nomeDoDiaDaSemana,
  somarDias,
  somarMeses,
} from "./datas";

/**
 * Limite técnico rígido de noites por estadia.
 *
 * Não é regra comercial: é o teto da transação que garante "uma noite tem no máximo um
 * ocupante". Ver docs/01-negocio/01-regras-de-disponibilidade.md (R8).
 */
export const MAX_NOITES_PERMITIDO = 60;

/** Acima deste fator sobre a diária base, a diária do período gera aviso. */
const FATOR_AVISO_DIARIA_ALTA = 10;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Temporada ou feriado: intervalo com diária e mínimo de noites próprios.
 *
 * `inicio` e `fim` são **inclusivos** e se referem à noite, não ao check-out — é assim
 * que o proprietário pensa ("do dia 29 ao dia 2 é réveillon").
 */
export interface PeriodoPreco {
  id: string;
  nome: string;
  inicio: DataISO;
  fim: DataISO;
  diariaCentavos: number;
  minNoites: number;
}

/** Configuração de preços de **uma** casa. Não existe preço global. */
export interface ConfigPrecos {
  diariaBaseCentavos: number;
  diariaFimDeSemanaCentavos: number;
  diasFimDeSemana: DiaDaSemana[];
  temporadas: PeriodoPreco[];
  feriados: PeriodoPreco[];
  minNoitesPadrao: number;
  maxNoites: number;
  taxaLimpezaCentavos: number;
  hospedesInclusos: number;
  capacidadeMaxima: number;
  valorHospedeExtraPorNoiteCentavos: number;
}

/** O que a cotação precisa da configuração geral do sistema. */
export interface ConfigGeralCotacao {
  antecedenciaMinimaDias: number;
  janelaReservaMeses: number;
}

export interface EntradaCotacao {
  checkin: DataISO;
  checkout: DataISO;
  hospedes: number;
  /** Data corrente em America/Sao_Paulo. Use `hojeEmSaoPaulo`. */
  hoje: DataISO;
  configGeral: ConfigGeralCotacao;
  /**
   * Desconto manual do administrador, em centavos. A cotação **pública** nunca passa
   * este campo: não há cupom, e o desconto só existe quando o admin registra um.
   */
  descontoCentavos?: number;
}

export type TipoTarifa = "FERIADO" | "TEMPORADA" | "FIM_DE_SEMANA" | "BASE";

export type LinhaDetalhamento =
  | {
      tipo: "NOITE";
      data: DataISO;
      tarifa: TipoTarifa;
      rotulo: string;
      /** Presente quando a tarifa é FERIADO ou TEMPORADA: explica o valor ao hóspede. */
      periodoNome?: string;
      valorCentavos: number;
    }
  | { tipo: "HOSPEDE_EXTRA"; quantidade: number; rotulo: string; valorCentavos: number }
  | { tipo: "DESCONTO"; rotulo: string; valorCentavos: number }
  | { tipo: "TAXA_LIMPEZA"; rotulo: string; valorCentavos: number };

export interface Cotacao {
  noites: number;
  subtotalDiariasCentavos: number;
  acrescimoHospedesCentavos: number;
  descontoCentavos: number;
  taxaLimpezaCentavos: number;
  totalCentavos: number;
  minNoitesExigido: number;
  detalhamento: LinhaDetalhamento[];
}

export type CodigoErroCotacao =
  | "DATA_INVALIDA"
  | "INTERVALO_INVALIDO"
  | "ANTECEDENCIA_MINIMA"
  | "FORA_DA_JANELA"
  | "MAXIMO_NOITES"
  | "CAPACIDADE_EXCEDIDA"
  | "MINIMO_NOITES";

export interface ErroCotacao {
  erro: CodigoErroCotacao;
  /** Mensagem pronta para a tela, em pt-BR. */
  mensagem: string;
  /** Dados que a interface precisa para contextualizar o erro. */
  detalhes: Record<string, string | number>;
}

export type ResultadoCotacao = Cotacao | ErroCotacao;

/** Discrimina o resultado de `calcularCotacao`. */
export function ehErroCotacao(resultado: ResultadoCotacao): resultado is ErroCotacao {
  return "erro" in resultado;
}

// ---------------------------------------------------------------------------
// Cotação
// ---------------------------------------------------------------------------

function falha(
  erro: CodigoErroCotacao,
  mensagem: string,
  detalhes: Record<string, string | number> = {},
): ErroCotacao {
  return { erro, mensagem, detalhes };
}

/**
 * Calcula a cotação de uma estadia, ou devolve o **primeiro** erro de validação.
 *
 * A ordem das validações é parte do contrato: uma causa por vez, da mais básica para a
 * mais específica, para que a tela sempre mostre o problema mais acionável.
 */
export function calcularCotacao(
  config: ConfigPrecos,
  entrada: EntradaCotacao,
): ResultadoCotacao {
  const { checkin, checkout, hospedes, hoje, configGeral } = entrada;

  // 1. Datas sintaticamente válidas e existentes no calendário.
  for (const [campo, valor] of [
    ["checkin", checkin],
    ["checkout", checkout],
    ["hoje", hoje],
  ] as const) {
    if (!ehDataValida(valor)) {
      return falha("DATA_INVALIDA", "Data inválida.", { campo });
    }
  }

  // 2. O check-out é estritamente depois do check-in: estadia de zero noite não existe.
  const totalNoites = diferencaEmDias(checkin, checkout);
  if (totalNoites <= 0) {
    return falha(
      "INTERVALO_INVALIDO",
      "A data de saída precisa ser depois da data de entrada.",
      { checkin, checkout },
    );
  }

  // 3. Antecedência mínima: reserva para hoje vai pelo WhatsApp.
  const primeiroCheckinPermitido = somarDias(hoje, configGeral.antecedenciaMinimaDias);
  if (compararDatas(checkin, primeiroCheckinPermitido) < 0) {
    return falha(
      "ANTECEDENCIA_MINIMA",
      configGeral.antecedenciaMinimaDias === 1
        ? "A entrada precisa ser a partir de amanhã. Para datas mais próximas, fale com o proprietário."
        : `A entrada precisa ter pelo menos ${configGeral.antecedenciaMinimaDias} dias de antecedência.`,
      {
        antecedenciaMinimaDias: configGeral.antecedenciaMinimaDias,
        primeiroCheckinPermitido,
      },
    );
  }

  // 4. Janela de reserva: não comprometemos preço de um futuro distante.
  const ultimoCheckinPermitido = somarMeses(hoje, configGeral.janelaReservaMeses);
  if (compararDatas(checkin, ultimoCheckinPermitido) > 0) {
    return falha(
      "FORA_DA_JANELA",
      `Ainda não abrimos reservas para essa data. A agenda vai até ${configGeral.janelaReservaMeses} meses à frente.`,
      { janelaReservaMeses: configGeral.janelaReservaMeses, ultimoCheckinPermitido },
    );
  }

  // 5. Máximo de noites. Verificado pela contagem, antes de materializar a lista de
  //    noites — um pedido absurdo não deve alocar nada.
  const maxNoites = Math.min(config.maxNoites, MAX_NOITES_PERMITIDO);
  if (totalNoites > maxNoites) {
    return falha("MAXIMO_NOITES", `A estadia pode ter no máximo ${maxNoites} noites.`, {
      maxNoites,
      noitesPedidas: totalNoites,
    });
  }

  // 6. Capacidade. Hóspede fracionário ou ausente cai aqui de propósito: o contrato de
  //    erro da rota é fechado, e a fronteira (zod) já rejeita o tipo errado antes.
  if (!Number.isInteger(hospedes) || hospedes < 1 || hospedes > config.capacidadeMaxima) {
    return falha(
      "CAPACIDADE_EXCEDIDA",
      `Esta casa acomoda até ${config.capacidadeMaxima} hóspedes.`,
      { capacidadeMaxima: config.capacidadeMaxima, hospedesPedidos: hospedes },
    );
  }

  const noites = noitesDe(checkin, checkout);
  const primeiraNoite = noites[0] as DataISO;
  const ultimaNoite = noites[noites.length - 1] as DataISO;

  // 7. Mínimo de noites: o maior mínimo entre os períodos tocados e o padrão da casa.
  const minimo = minimoDeNoites(config, primeiraNoite, ultimaNoite);
  if (totalNoites < minimo.exigido) {
    return falha(
      "MINIMO_NOITES",
      minimo.periodoNome === undefined
        ? `A estadia mínima é de ${minimo.exigido} noites.`
        : `A estadia mínima é de ${minimo.exigido} noites em ${minimo.periodoNome}.`,
      {
        minimoExigido: minimo.exigido,
        noitesPedidas: totalNoites,
        ...(minimo.periodoNome === undefined ? {} : { periodoNome: minimo.periodoNome }),
      },
    );
  }

  return montarCotacao(config, entrada, noites, minimo.exigido);
}

function montarCotacao(
  config: ConfigPrecos,
  entrada: EntradaCotacao,
  noites: DataISO[],
  minNoitesExigido: number,
): Cotacao {
  const detalhamento: LinhaDetalhamento[] = [];
  let subtotalDiariasCentavos = 0;

  for (const noite of noites) {
    const tarifa = tarifaDaNoite(config, noite);
    subtotalDiariasCentavos += tarifa.valorCentavos;
    detalhamento.push({
      tipo: "NOITE",
      data: noite,
      tarifa: tarifa.tipo,
      rotulo: nomeDoDiaDaSemana(noite),
      ...(tarifa.periodoNome === undefined ? {} : { periodoNome: tarifa.periodoNome }),
      valorCentavos: tarifa.valorCentavos,
    });
  }

  const hospedesExtras = Math.max(0, entrada.hospedes - config.hospedesInclusos);
  const acrescimoHospedesCentavos =
    hospedesExtras * config.valorHospedeExtraPorNoiteCentavos * noites.length;

  // Linha omitida quando zera: "R$ 0,00" na tela é ruído (UC-P03, A7).
  if (acrescimoHospedesCentavos > 0) {
    detalhamento.push({
      tipo: "HOSPEDE_EXTRA",
      quantidade: hospedesExtras,
      rotulo: rotuloHospedeExtra(hospedesExtras, noites.length),
      valorCentavos: acrescimoHospedesCentavos,
    });
  }

  const subtotal = subtotalDiariasCentavos + acrescimoHospedesCentavos;

  // O desconto incide sobre o subtotal, nunca sobre a limpeza, e nunca deixa o total
  // negativo.
  const descontoPedido = Math.max(0, Math.trunc(entrada.descontoCentavos ?? 0));
  const descontoCentavos = Math.min(descontoPedido, subtotal);
  if (descontoCentavos > 0) {
    detalhamento.push({
      tipo: "DESCONTO",
      rotulo: "Desconto",
      valorCentavos: -descontoCentavos,
    });
  }

  if (config.taxaLimpezaCentavos > 0) {
    detalhamento.push({
      tipo: "TAXA_LIMPEZA",
      rotulo: "Taxa de limpeza",
      valorCentavos: config.taxaLimpezaCentavos,
    });
  }

  return {
    noites: noites.length,
    subtotalDiariasCentavos,
    acrescimoHospedesCentavos,
    descontoCentavos,
    taxaLimpezaCentavos: config.taxaLimpezaCentavos,
    totalCentavos: subtotal - descontoCentavos + config.taxaLimpezaCentavos,
    minNoitesExigido,
    detalhamento,
  };
}

function rotuloHospedeExtra(quantidade: number, noites: number): string {
  const hospedes = quantidade === 1 ? "1 hóspede extra" : `${quantidade} hóspedes extras`;
  return `${hospedes} × ${noites} ${noites === 1 ? "noite" : "noites"}`;
}

interface TarifaDaNoite {
  tipo: TipoTarifa;
  valorCentavos: number;
  periodoNome?: string;
}

/**
 * Diária de uma noite, por precedência: feriado > temporada > fim de semana > base.
 * A primeira regra que casar vence.
 */
function tarifaDaNoite(config: ConfigPrecos, noite: DataISO): TarifaDaNoite {
  const feriado = periodoVencedor(config.feriados, noite);
  if (feriado !== undefined) {
    return {
      tipo: "FERIADO",
      valorCentavos: feriado.diariaCentavos,
      periodoNome: feriado.nome,
    };
  }

  const temporada = periodoVencedor(config.temporadas, noite);
  if (temporada !== undefined) {
    return {
      tipo: "TEMPORADA",
      valorCentavos: temporada.diariaCentavos,
      periodoNome: temporada.nome,
    };
  }

  if (config.diasFimDeSemana.includes(diaDaSemana(noite))) {
    return { tipo: "FIM_DE_SEMANA", valorCentavos: config.diariaFimDeSemanaCentavos };
  }

  return { tipo: "BASE", valorCentavos: config.diariaBaseCentavos };
}

/**
 * Período que vale para a noite. Com sobreposição, vence a **maior diária**.
 *
 * Sobreposição é quase sempre erro de cadastro, e `validarConfigPrecos` avisa o admin
 * ao salvar — mas não pode derrubar a cotação de um visitante.
 */
function periodoVencedor(
  periodos: PeriodoPreco[],
  noite: DataISO,
): PeriodoPreco | undefined {
  let vencedor: PeriodoPreco | undefined;
  for (const periodo of periodos) {
    if (compararDatas(noite, periodo.inicio) < 0) continue;
    if (compararDatas(noite, periodo.fim) > 0) continue;
    if (vencedor === undefined || periodo.diariaCentavos > vencedor.diariaCentavos) {
      vencedor = periodo;
    }
  }
  return vencedor;
}

/**
 * Mínimo de noites exigido e quem o impôs.
 *
 * Regra deliberadamente conservadora: **tocar** o período em qualquer noite basta para
 * o mínimo dele valer. Com empate, vence o primeiro encontrado (feriados antes de
 * temporadas), para que o resultado seja determinístico.
 */
function minimoDeNoites(
  config: ConfigPrecos,
  primeiraNoite: DataISO,
  ultimaNoite: DataISO,
): { exigido: number; periodoNome?: string } {
  let exigido = config.minNoitesPadrao;
  let periodoNome: string | undefined;

  for (const periodo of [...config.feriados, ...config.temporadas]) {
    const tocaEstadia =
      compararDatas(periodo.inicio, ultimaNoite) <= 0 &&
      compararDatas(periodo.fim, primeiraNoite) >= 0;
    if (tocaEstadia && periodo.minNoites > exigido) {
      exigido = periodo.minNoites;
      periodoNome = periodo.nome;
    }
  }

  return periodoNome === undefined ? { exigido } : { exigido, periodoNome };
}

// ---------------------------------------------------------------------------
// Validação da configuração de preços
// ---------------------------------------------------------------------------

export type CodigoProblemaConfig =
  | "VALOR_INVALIDO"
  | "DIARIA_BASE_OBRIGATORIA"
  | "DIA_SEMANA_INVALIDO"
  | "PERIODO_INVERTIDO"
  | "PERIODO_MIN_NOITES_INVALIDO"
  | "PERIODO_ID_DUPLICADO"
  | "HOSPEDES_INCLUSOS_INVALIDO"
  | "MIN_NOITES_PADRAO_INVALIDO"
  | "MAX_NOITES_INVALIDO"
  | "PERIODOS_SOBREPOSTOS"
  | "DIARIA_MUITO_ALTA"
  | "PERIODO_NO_PASSADO";

export interface ProblemaConfig {
  codigo: CodigoProblemaConfig;
  campo: string;
  mensagem: string;
}

export interface ResultadoValidacaoConfig {
  erros: ProblemaConfig[];
  avisos: ProblemaConfig[];
}

/**
 * Valida a configuração de preços de uma casa (UC-A04).
 *
 * **Erro** impede o salvamento; **aviso** não impede, só aparece na tela — porque
 * sobreposição de períodos e diária alta são prováveis erros de cadastro, não
 * impossibilidades.
 *
 * `hoje` é opcional: sem ele, a verificação de período no passado é omitida, e a função
 * continua pura.
 */
export function validarConfigPrecos(
  config: ConfigPrecos,
  hoje?: DataISO,
): ResultadoValidacaoConfig {
  const erros: ProblemaConfig[] = [];
  const avisos: ProblemaConfig[] = [];

  const erro = (codigo: CodigoProblemaConfig, campo: string, mensagem: string): void => {
    erros.push({ codigo, campo, mensagem });
  };
  const aviso = (codigo: CodigoProblemaConfig, campo: string, mensagem: string): void => {
    avisos.push({ codigo, campo, mensagem });
  };

  const valoresEmCentavos: Array<[string, number]> = [
    ["diariaBaseCentavos", config.diariaBaseCentavos],
    ["diariaFimDeSemanaCentavos", config.diariaFimDeSemanaCentavos],
    ["taxaLimpezaCentavos", config.taxaLimpezaCentavos],
    ["valorHospedeExtraPorNoiteCentavos", config.valorHospedeExtraPorNoiteCentavos],
  ];
  for (const [campo, valor] of valoresEmCentavos) {
    if (!ehCentavosValido(valor)) {
      erro(
        "VALOR_INVALIDO",
        campo,
        "O valor precisa ser um número inteiro de centavos, maior ou igual a zero.",
      );
    }
  }

  if (!ehCentavosValido(config.diariaBaseCentavos) || config.diariaBaseCentavos === 0) {
    erro(
      "DIARIA_BASE_OBRIGATORIA",
      "diariaBaseCentavos",
      "A diária base precisa ser maior que zero.",
    );
  }

  for (const dia of config.diasFimDeSemana) {
    if (!DIAS_DA_SEMANA.includes(dia)) {
      erro(
        "DIA_SEMANA_INVALIDO",
        "diasFimDeSemana",
        `"${String(dia)}" não é um dia da semana válido.`,
      );
    }
  }

  if (
    !Number.isInteger(config.capacidadeMaxima) ||
    config.capacidadeMaxima < 1 ||
    !Number.isInteger(config.hospedesInclusos) ||
    config.hospedesInclusos < 1 ||
    config.hospedesInclusos > config.capacidadeMaxima
  ) {
    erro(
      "HOSPEDES_INCLUSOS_INVALIDO",
      "hospedesInclusos",
      "Os hóspedes inclusos precisam ser pelo menos 1 e no máximo a capacidade da casa.",
    );
  }

  if (
    !Number.isInteger(config.maxNoites) ||
    config.maxNoites < 1 ||
    config.maxNoites > MAX_NOITES_PERMITIDO
  ) {
    erro(
      "MAX_NOITES_INVALIDO",
      "maxNoites",
      `O máximo de noites precisa ser entre 1 e ${MAX_NOITES_PERMITIDO}.`,
    );
  }

  if (
    !Number.isInteger(config.minNoitesPadrao) ||
    config.minNoitesPadrao < 1 ||
    config.minNoitesPadrao > config.maxNoites
  ) {
    erro(
      "MIN_NOITES_PADRAO_INVALIDO",
      "minNoitesPadrao",
      "O mínimo de noites precisa ser entre 1 e o máximo de noites.",
    );
  }

  const idsVistos = new Set<string>();
  for (const [campo, periodos] of [
    ["feriados", config.feriados],
    ["temporadas", config.temporadas],
  ] as const) {
    for (const periodo of periodos) {
      const onde = `${campo}.${periodo.id}`;

      if (idsVistos.has(periodo.id)) {
        erro(
          "PERIODO_ID_DUPLICADO",
          onde,
          `O identificador "${periodo.id}" está repetido.`,
        );
      }
      idsVistos.add(periodo.id);

      if (!ehCentavosValido(periodo.diariaCentavos) || periodo.diariaCentavos === 0) {
        erro(
          "VALOR_INVALIDO",
          `${onde}.diariaCentavos`,
          "A diária do período precisa ser maior que zero, em centavos inteiros.",
        );
      }

      if (!ehDataValida(periodo.inicio) || !ehDataValida(periodo.fim)) {
        erro(
          "PERIODO_INVERTIDO",
          onde,
          "As datas do período precisam estar no formato AAAA-MM-DD.",
        );
      } else if (compararDatas(periodo.fim, periodo.inicio) < 0) {
        erro(
          "PERIODO_INVERTIDO",
          onde,
          "A data final do período não pode ser antes da inicial.",
        );
      } else if (hoje !== undefined && compararDatas(periodo.fim, hoje) < 0) {
        aviso("PERIODO_NO_PASSADO", onde, `"${periodo.nome}" já terminou. Considere remover.`);
      }

      if (!Number.isInteger(periodo.minNoites) || periodo.minNoites < 1) {
        erro(
          "PERIODO_MIN_NOITES_INVALIDO",
          `${onde}.minNoites`,
          "O mínimo de noites do período precisa ser pelo menos 1.",
        );
      }

      if (
        ehCentavosValido(periodo.diariaCentavos) &&
        ehCentavosValido(config.diariaBaseCentavos) &&
        config.diariaBaseCentavos > 0 &&
        periodo.diariaCentavos > config.diariaBaseCentavos * FATOR_AVISO_DIARIA_ALTA
      ) {
        aviso(
          "DIARIA_MUITO_ALTA",
          `${onde}.diariaCentavos`,
          `A diária de "${periodo.nome}" é mais de ${FATOR_AVISO_DIARIA_ALTA}× a diária base. Confira se o valor está em centavos.`,
        );
      }
    }

    for (const [a, b] of paresSobrepostos(periodos)) {
      aviso(
        "PERIODOS_SOBREPOSTOS",
        campo,
        `"${a.nome}" e "${b.nome}" se sobrepõem. Na noite em comum vale a maior diária.`,
      );
    }
  }

  return { erros, avisos };
}

function ehCentavosValido(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}

/** Pares de períodos da mesma lista que compartilham ao menos uma noite. */
function paresSobrepostos(periodos: PeriodoPreco[]): Array<[PeriodoPreco, PeriodoPreco]> {
  const pares: Array<[PeriodoPreco, PeriodoPreco]> = [];
  for (let i = 0; i < periodos.length; i += 1) {
    for (let j = i + 1; j < periodos.length; j += 1) {
      const a = periodos[i] as PeriodoPreco;
      const b = periodos[j] as PeriodoPreco;
      if (!ehDataValida(a.inicio) || !ehDataValida(a.fim)) continue;
      if (!ehDataValida(b.inicio) || !ehDataValida(b.fim)) continue;
      if (compararDatas(a.inicio, b.fim) <= 0 && compararDatas(b.inicio, a.fim) <= 0) {
        pares.push([a, b]);
      }
    }
  }
  return pares;
}
