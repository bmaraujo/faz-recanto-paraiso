/**
 * Regras puras de UC-A02 (cadastrar e editar casas) que não dependem de banco.
 *
 * O resto do UC — unicidade de slug (RN3), imutabilidade após publicar (RN4),
 * controle de versão otimista (E9), exclusão com verificação de reservas — exige
 * DynamoDB e pertence a `backend/src/handlers/api-admin.ts` quando essa camada
 * existir. O que cabe aqui, sem I/O:
 *
 * - `sugerirSlug`: a sugestão automática de slug a partir do nome (RN6).
 * - `ehUrlDeMapaPermitida`: a allowlist de host do `mapaEmbedUrl`, que vai para um
 *   `<iframe src>` e por isso é entrada de risco (armadilha nº 2 do UC).
 * - `avaliarCompletudeParaAtivar`: o que falta para a casa poder virar `ATIVA` (RN7).
 */

import { z } from "zod";

/** RN5: formato e tamanho do slug. Único (RN3) e imutável após publicar (RN4) —
 * as duas regras que exigem banco e por isso não estão aqui. */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_TAMANHO_MAXIMO = 60;

export const TIPOS_CAMA = ["CASAL", "SOLTEIRO", "BELICHE", "REDE"] as const;
export type TipoCama = (typeof TIPOS_CAMA)[number];
export const tipoCamaSchema = z.enum(TIPOS_CAMA);

/**
 * Sugere um slug a partir do nome da casa (RN6): minúsculas, sem acento, espaços e
 * símbolos virando `-`, sem hífen duplicado ou nas pontas, truncado ao limite de
 * `RN5`. É só uma sugestão — o admin pode editá-la antes de salvar, e o resultado
 * não é garantido válido para nomes degenerados (só símbolos, por exemplo);
 * quem salva valida contra `SLUG_REGEX` de qualquer forma.
 */
export function sugerirSlug(nome: string): string {
  const normalizado = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove os diacriticos (acentos, til, cedilha)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizado.slice(0, SLUG_TAMANHO_MAXIMO).replace(/-+$/g, "");
}

/** Hosts aceitos para `mapaEmbedUrl` (contrato técnico de UC-A02). */
const HOSTS_OPENSTREETMAP = new Set(["openstreetmap.org", "www.openstreetmap.org"]);
const HOSTS_GOOGLE = new Set(["google.com", "www.google.com"]);

/**
 * Valida `mapaEmbedUrl` antes de ir para um `<iframe src>` no site público.
 *
 * Sem isso, um admin comprometido (ou um campo mal validado) seria injeção de
 * iframe arbitrário — a armadilha nº 2 do UC-A02. Exige `https:` e um host da
 * allowlist; para o Google, exige também que o caminho seja `/maps...`, porque
 * "google.com/maps" na tabela do contrato é a combinação host+caminho, não só o host.
 */
export function ehUrlDeMapaPermitida(url: string): boolean {
  let analisada: URL;
  try {
    analisada = new URL(url);
  } catch {
    return false;
  }

  if (analisada.protocol !== "https:") return false;

  const host = analisada.hostname.toLowerCase();
  if (HOSTS_OPENSTREETMAP.has(host)) return true;
  return HOSTS_GOOGLE.has(host) && analisada.pathname.startsWith("/maps");
}

/** O que `avaliarCompletudeParaAtivar` precisa saber de cada foto da casa. */
export interface FotoParaCompletude {
  principal: boolean;
  textoAlternativo: string;
}

export interface DadosParaAtivacao {
  resumo: string;
  descricao: string;
  fotos: FotoParaCompletude[];
  /** Resultado de `validarConfigPrecos(config).erros.length === 0`, já calculado por
   * quem chama — este módulo não conhece `ConfigPrecos`, para não se acoplar a ele. */
  precosValidos: boolean;
}

export type ItemFaltandoParaAtivar =
  | "fotos"
  | "fotoPrincipal"
  | "textoAlternativo"
  | "precos"
  | "resumo"
  | "descricao";

export interface ResultadoCompletudeAtivacao {
  completa: boolean;
  faltando: ItemFaltandoParaAtivar[];
}

/**
 * RN7: o que falta para a casa poder virar `ATIVA`. Devolve **todos** os itens que
 * faltam de uma vez — como `validarConfigPrecos`, o admin corrige tudo numa
 * passada, em vez de descobrir um problema por tentativa.
 */
export function avaliarCompletudeParaAtivar(
  dados: DadosParaAtivacao,
): ResultadoCompletudeAtivacao {
  const faltando: ItemFaltandoParaAtivar[] = [];

  if (dados.fotos.length === 0) {
    faltando.push("fotos");
  } else {
    if (!dados.fotos.some((foto) => foto.principal)) faltando.push("fotoPrincipal");
    if (dados.fotos.some((foto) => foto.textoAlternativo.trim() === "")) {
      faltando.push("textoAlternativo");
    }
  }

  if (!dados.precosValidos) faltando.push("precos");
  if (dados.resumo.trim() === "") faltando.push("resumo");
  if (dados.descricao.trim() === "") faltando.push("descricao");

  return { completa: faltando.length === 0, faltando };
}
