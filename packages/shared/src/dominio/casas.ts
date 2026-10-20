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

import type { ComodidadeCodigo } from "../comodidades";

/** RN5: formato e tamanho do slug. Único (RN3) e imutável após publicar (RN4) —
 * as duas regras que exigem banco e por isso não estão aqui. */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_TAMANHO_MAXIMO = 60;

export const TIPOS_CAMA = ["CASAL", "SOLTEIRO", "BELICHE", "REDE"] as const;
export type TipoCama = (typeof TIPOS_CAMA)[number];
export const tipoCamaSchema = z.enum(TIPOS_CAMA);

/** RN1/RN2: só `ATIVA` aparece no site público. Única fonte deste enum — o zod de
 * `schemas/casa.ts` importa `ESTADOS_CASA`, não o repete. */
export const ESTADOS_CASA = ["RASCUNHO", "ATIVA", "INATIVA"] as const;
export type StatusCasa = (typeof ESTADOS_CASA)[number];

export interface Cama {
  tipo: TipoCama;
  quantidade: number;
  ambiente: string;
}

export interface Distancia {
  referencia: string;
  km: number;
}

/** RN11: `enderecoCompleto` nunca sai do backoffice/`PRE_CHECKIN` — quem monta a
 * resposta pública usa um tipo derivado deste, sem este campo (ainda não existe
 * porque nenhum handler lê `Casa` do banco; ver `backend/src/lib/db.ts`). */
export interface Localizacao {
  enderecoPublico: string;
  enderecoCompleto?: string;
  lat?: number;
  lng?: number;
  mapaEmbedUrl?: string;
  comoChegar?: string;
  distancias?: Distancia[];
}

/** RN2 (UC-A03): formatos aceitos para fotos de casa. SVG nunca é aceito — é
 * XML que pode conter `<script>` (armadilha nº 7 do UC-A03). */
export const TIPOS_FOTO_ACEITOS = ["image/webp", "image/jpeg", "image/png"] as const;
export type TipoFotoAceito = (typeof TIPOS_FOTO_ACEITOS)[number];

/** RN1 (UC-A03): no máximo 40 fotos por casa. */
export const LIMITE_FOTOS_POR_CASA = 40;

/** RN3 (UC-A03): tamanho máximo de uma foto após o redimensionamento no
 * navegador — imposto pela condição `content-length-range` da policy do S3,
 * não por uma validação da Lambda (ver `backend/src/lib/s3.ts`). */
export const TAMANHO_MAX_FOTO_BYTES = 3 * 1024 * 1024;

const EXTENSAO_POR_TIPO_FOTO: Record<TipoFotoAceito, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * RN11: a chave de uma foto fica sempre sob `midia/casas/<casaId>/`. RN10: o
 * sufixo aleatório (gerado por quem chama — `node:crypto`, fora deste módulo
 * puro) torna a chave imprevisível e nunca reaproveitada, o que permite ao
 * CloudFront cachear a imagem como imutável por 1 ano.
 *
 * Sem o segmento de "slug da legenda" que
 * docs/03-tecnico/07-armazenamento-de-imagens.md ilustra: a legenda só é
 * conhecida no registro da foto (`POST .../fotos`, passo 6 do fluxo
 * principal), depois que o arquivo já foi enviado para esta mesma chave
 * (passo 5) — não há como incluir no nome algo que ainda não existe no
 * momento em que a chave nasce, no presigned POST (passo 4).
 */
export function construirChaveFoto(
  casaId: string,
  fotoId: string,
  contentType: TipoFotoAceito,
  sufixoAleatorio: string,
): string {
  return `midia/casas/${casaId}/${fotoId}-${sufixoAleatorio}.${EXTENSAO_POR_TIPO_FOTO[contentType]}`;
}

/** Uma foto embutida no item da casa (docs/03-tecnico/02-modelo-de-dados.md,
 * seção "Fotos"). `principal` é exclusiva: no máximo uma foto por casa a tem. */
export interface Foto {
  fotoId: string;
  chave: string;
  largura: number;
  altura: number;
  bytes: number;
  legenda: string;
  textoAlternativo: string;
  ordem: number;
  principal: boolean;
  enviadaEm: string;
}

/**
 * A casa como ela é persistida (`CASA#<casaId>/META`) — não o corpo que o admin
 * envia (`CasaEntrada`, em `schemas/casa.ts`): esta tem os campos que só existem
 * depois de criada (`casaId`, `tokenIcal`, `versao`) ou que vêm de outros UCs
 * (`fotos`, de UC-A03). As duas formas duplicam os campos comuns de propósito —
 * `dominio/` não importa `schemas/` (a direção é sempre a contrária), para o
 * núcleo de regras não depender de como a entrada é validada.
 */
export interface Casa {
  casaId: string;
  slug: string;
  nome: string;
  status: StatusCasa;
  ordem: number;
  destaque: boolean;
  resumo: string;
  descricao: string;
  capacidadeMaxima: number;
  hospedesInclusos: number;
  quartos: number;
  banheiros: number;
  camas: Cama[];
  comodidades: ComodidadeCodigo[];
  regras?: string;
  localizacao: Localizacao;
  fotos: Foto[];
  tokenIcal: string;
  publicacaoPendente: boolean;
  versao: number;
  criadoEm: string;
  atualizadoEm: string;
  atualizadoPor: string;
}

/**
 * RN4: o slug é imutável depois da primeira publicação. O modelo ainda não tem
 * um campo "já foi publicada" dedicado (nasceria com UC-A14) — esta fase usa
 * `statusAtual !== "RASCUNHO"` como proxy: nenhum fluxo documentado de UC-A02
 * leva uma casa de volta a `RASCUNHO` depois de `ATIVA`/`INATIVA`, então a
 * primeira vez que o status deixa de ser `RASCUNHO` é, na prática, a primeira
 * vez que a casa pode ter sido publicada.
 */
export function ehEdicaoDeSlugPermitida(
  statusAtual: StatusCasa,
  slugAtual: string,
  novoSlug: string,
): boolean {
  return slugAtual === novoSlug || statusAtual === "RASCUNHO";
}

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
