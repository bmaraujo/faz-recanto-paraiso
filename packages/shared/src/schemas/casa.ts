/**
 * Corpo de `POST`/`PUT /api/admin/casas` (UC-A02).
 *
 * Mesma divisão de responsabilidade do resto do pacote: aqui é forma (tipo, faixa,
 * formato, enum fechado); unicidade de slug (RN3), imutabilidade após publicar
 * (RN4) e controle de versão (E9) exigem banco e ficam para o handler.
 *
 * **Exceção deliberada:** `hospedesInclusos <= capacidadeMaxima` (RN8) está aqui,
 * não em `dominio/casas.ts`, porque o próprio contrato documenta essa violação como
 * `400` — a mesma família de erro dos outros campos desta tabela, não um código de
 * domínio próprio como `MINIMO_NOITES` ou `CASA_INCOMPLETA`.
 *
 * `fotos` não aparece aqui: a casa nasce sem foto (RN1) e elas entram por
 * UC-A03 (gerenciar-fotos), um fluxo próprio de upload que ainda não foi
 * implementado — não é campo deste formulário.
 *
 * Alguns limites abaixo (tamanho de `ambiente`, de `comoChegar`, de
 * `enderecoPublico`/`enderecoCompleto`, quantidade de camas) são teto técnico meu,
 * não número da documentação, porque o contrato não os especifica. Estão marcados
 * como tal para não serem confundidos com regra de negócio.
 */

import { z } from "zod";

import { comodidadeSchema } from "../comodidades";
import { ESTADOS_CASA, SLUG_REGEX, ehUrlDeMapaPermitida, tipoCamaSchema } from "../dominio/casas";
import { ulidSchema } from "./comum";

export const statusCasaSchema = z.enum(ESTADOS_CASA);

export const camaSchema = z.object({
  tipo: tipoCamaSchema,
  // Sem teto documentado; 50 é o mesmo teto técnico usado em quartos/banheiros.
  quantidade: z.number().int().positive().max(50),
  // Sem teto documentado.
  ambiente: z.string().min(1).max(80),
});

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

const mapaEmbedUrlSchema = z
  .string()
  .url()
  .refine(ehUrlDeMapaPermitida, {
    message:
      "Só são aceitos mapas do OpenStreetMap ou do Google Maps, em https.",
  });

export const distanciaSchema = z.object({
  // Sem teto documentado.
  referencia: z.string().min(1).max(120),
  km: z.number().min(0).max(9999),
});

export const localizacaoSchema = z.object({
  // Vai para o site público (RN11) — sem teto documentado.
  enderecoPublico: z.string().min(1).max(300),
  // RN11: nunca em endpoint público; só no backoffice e no e-mail de PRE_CHECKIN.
  // Sem teto documentado.
  enderecoCompleto: z.string().min(1).max(500).optional(),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
  mapaEmbedUrl: mapaEmbedUrlSchema.optional(),
  // Markdown; sem teto documentado — mesma ordem de grandeza de `descricao`.
  comoChegar: z.string().max(10_000).optional(),
  distancias: z.array(distanciaSchema).optional(),
});

/**
 * Campos comuns a criação e edição. `status` aqui é só forma — RN1 ("a casa nasce
 * em RASCUNHO") é o handler que decide se ignora ou rejeita um valor diferente no
 * `POST` de criação; este schema aceita os três valores porque o mesmo corpo serve
 * à edição, onde os três são válidos.
 */
export const casaEntradaSchema = z
  .object({
    nome: z.string().min(3).max(80),
    slug: z.string().min(3).max(60).regex(SLUG_REGEX, {
      message: "Use apenas letras minúsculas, números e hífen (ex.: casa-do-lago).",
    }),
    resumo: z.string().min(20).max(200),
    descricao: z.string().min(50).max(10_000),
    status: statusCasaSchema,
    ordem: z.number().int().min(0).max(9999),
    destaque: z.boolean(),
    capacidadeMaxima: z.number().int().min(1).max(50),
    hospedesInclusos: z.number().int().positive(),
    quartos: z.number().int().min(0).max(50),
    banheiros: z.number().int().min(0).max(50),
    camas: z.array(camaSchema),
    comodidades: z.array(comodidadeSchema),
    // Markdown; sem teto documentado — mesma ordem de grandeza de `descricao`.
    regras: z.string().max(10_000).optional(),
    localizacao: localizacaoSchema,
  })
  .refine((casa) => casa.hospedesInclusos <= casa.capacidadeMaxima, {
    message: "Os hóspedes inclusos não podem passar da capacidade máxima da casa.",
    path: ["hospedesInclusos"],
  });

export type CasaEntrada = z.infer<typeof casaEntradaSchema>;

/** `PUT /api/admin/casas/{casaId}`: mesmo corpo, com a versão lida (E9). */
export const casaEdicaoSchema = casaEntradaSchema.and(
  z.object({ versao: z.number().int().nonnegative() }),
);

export type CasaEdicao = z.infer<typeof casaEdicaoSchema>;

/** `POST /api/admin/casas/{casaId}/status`: valida RN7 no handler, não aqui. */
export const alterarStatusCasaSchema = z.object({ status: statusCasaSchema });

/**
 * `POST /api/admin/casas/{casaId}/fotos/upload` (UC-A03): o corpo que pede o
 * presigned POST. `bytes` é só informativo — o tamanho real após o
 * redimensionamento no navegador; o teto de 3 MB (RN3) é imposto pela
 * condição `content-length-range` da policy do S3, não validado aqui.
 *
 * `contentType` é só forma aqui (uma string não vazia) — RN2 ("só
 * WebP/JPEG/PNG, nunca SVG") é regra de negócio, não forma, e por isso vira
 * `422 TIPO_NAO_SUPORTADO` no handler (contra `TIPOS_FOTO_ACEITOS`), não
 * `400 ENTRADA_INVALIDA` de um `z.enum()` aqui. Mesma separação de
 * responsabilidade do cabeçalho deste pacote (zod valida forma; regra de
 * negócio é de quem chama).
 */
export const fotoUploadSchema = z.object({
  contentType: z.string().min(1).max(100),
  nomeOriginal: z.string().min(1).max(255),
  bytes: z.number().int().positive(),
});

export type FotoUpload = z.infer<typeof fotoUploadSchema>;

/** Uma foto embutida no item da casa (UC-A03, ainda não implementado — este
 * schema existe só para `casaArmazenadaSchema` validar o que já estiver lá). */
export const fotoSchema = z.object({
  fotoId: ulidSchema,
  chave: z.string().min(1),
  largura: z.number().int().positive(),
  altura: z.number().int().positive(),
  bytes: z.number().int().positive(),
  legenda: z.string(),
  textoAlternativo: z.string(),
  ordem: z.number().int().min(0),
  principal: z.boolean(),
  enviadaEm: z.string(),
});

/**
 * A casa como ela é persistida (`CASA#<casaId>/META`) — os campos de
 * `casaEntradaSchema` mais os que só existem depois de criada. Usado por
 * `lib/db.ts#obterCasa` para validar a forma na leitura, mesmo princípio de
 * `obterConfigPrecos`: um item corrompido deve virar erro limpo no handler,
 * não um erro de runtime vazando de `casaEdicaoSchema`/dos handlers de UC-A02.
 */
export const casaArmazenadaSchema = casaEntradaSchema.and(
  z.object({
    casaId: ulidSchema,
    fotos: z.array(fotoSchema),
    tokenIcal: z.string().min(1),
    publicacaoPendente: z.boolean(),
    versao: z.number().int().nonnegative(),
    criadoEm: z.string(),
    atualizadoEm: z.string(),
    atualizadoPor: z.string(),
  }),
);
