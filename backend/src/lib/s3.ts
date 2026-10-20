/**
 * Adaptador S3 — presigned POST de upload de fotos (UC-A03). Único lugar do
 * backend que conhece o `S3Client`, mesma regra de camadas de `lib/db.ts`:
 * `domain/` nunca importa este módulo.
 *
 * O cliente é criado uma vez, em escopo de módulo — mesmo motivo de
 * `clienteDynamoDB` em `lib/db.ts`: reaproveita a conexão entre invocações do
 * mesmo container Lambda.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import { TAMANHO_MAX_FOTO_BYTES, formatarInstanteIso } from "@recanto/shared";

export const clienteS3 = new S3Client({});

/** RN/contrato de UC-A03: a policy expira em 5 minutos (E9 — um presigned
 * expirado leva o navegador a pedir um novo automaticamente, uma vez). */
const EXPIRACAO_PRESIGNED_SEGUNDOS = 300;

/**
 * Quantos bytes iniciais do objeto ler para verificar o magic number (RN13)
 * e extrair as dimensões (RN14) — não os 3 MB inteiros, pelo mesmo motivo de
 * custo que o próprio documento de imagens descreve para a verificação de
 * magic number ("só os primeiros bytes, não o arquivo inteiro"). 64 KiB é
 * generoso para a necessidade real: cobre PNG (cabeçalho nos primeiros 24
 * bytes) e WebP (nos primeiros 30) com folga enorme, e cobre o header JPEG
 * (marcadores até o `SOF0`/`SOF1`/`SOF2`) mesmo quando há um segmento EXIF
 * incomum antes dele — algo que o teto literal de 32 bytes do contrato
 * técnico (pensado só para o magic number, não para as dimensões) não
 * cobriria. Se um JPEG patológico tiver mais de 64 KiB de segmentos antes do
 * `SOF`, a extração de dimensões falha e o registro é recusado como
 * `ARQUIVO_INVALIDO` — falha fechada, não um novo `GetObject` maior.
 */
const BYTES_LEITURA_VERIFICACAO = 64 * 1024;

export function nomeBucket(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.BUCKET;
  if (bucket === undefined) {
    throw new Error("Variável de ambiente BUCKET não definida.");
  }
  return bucket;
}

export interface PresignedPostFoto {
  chave: string;
  url: string;
  campos: Record<string, string>;
  expiraEm: string;
}

/**
 * `POST .../fotos/upload` (UC-A03): devolve a policy assinada que autoriza o
 * navegador a enviar o arquivo direto ao S3, sem passar por esta Lambda.
 *
 * Condições da policy (docs/03-tecnico/07-armazenamento-de-imagens.md):
 * `content-length-range` de 1 B a 3 MB (RN3 — e é a razão de ser **presigned
 * POST, não PUT**: um PUT assinado não suporta esta condição, então um
 * cliente malicioso subiria um arquivo de qualquer tamanho) e `Content-Type`
 * exatamente igual ao declarado. A chave já chega pronta e exata de quem
 * chama (`construirChaveFoto`, `@recanto/shared`) — o `Key` do presigned POST
 * já é, por si só, uma condição de igualdade exata, mais restritiva que um
 * prefixo.
 */
export async function criarPresignedPostFoto(
  chave: string,
  contentType: string,
  agora: Date,
): Promise<PresignedPostFoto> {
  const { url, fields } = await createPresignedPost(clienteS3, {
    Bucket: nomeBucket(),
    Key: chave,
    Conditions: [
      { "Content-Type": contentType },
      ["content-length-range", 1, TAMANHO_MAX_FOTO_BYTES],
    ],
    Fields: { "Content-Type": contentType },
    Expires: EXPIRACAO_PRESIGNED_SEGUNDOS,
  });

  return {
    chave,
    url,
    campos: fields,
    expiraEm: formatarInstanteIso(new Date(agora.getTime() + EXPIRACAO_PRESIGNED_SEGUNDOS * 1000)),
  };
}

export interface MetadadosObjeto {
  bytes: number;
  contentType: string | undefined;
}

/**
 * `POST .../fotos` (UC-A03, registro): `HeadObject` na chave que o admin
 * informou — primeiro passo do que o documento de imagens descreve ("o
 * objeto existe? o tamanho está dentro do limite? o Content-Type está na
 * allowlist?"). `undefined` quando o objeto não existe (`404` do S3) — o
 * chamador decide o código de erro (hoje: `400 ENTRADA_INVALIDA`, "chave não
 * corresponde a nenhum arquivo enviado").
 */
export async function obterMetadadosObjeto(chave: string): Promise<MetadadosObjeto | undefined> {
  try {
    const resposta = await clienteS3.send(
      new HeadObjectCommand({ Bucket: nomeBucket(), Key: chave }),
    );
    return { bytes: resposta.ContentLength ?? 0, contentType: resposta.ContentType };
  } catch (erro) {
    if (erro instanceof NotFound) return undefined;
    throw erro;
  }
}

/**
 * Lê os primeiros `BYTES_LEITURA_VERIFICACAO` do objeto via `GetObject` com
 * `Range` — nunca o arquivo inteiro, mesmo ele podendo ter até 3 MB (RN3).
 * Alimenta `domain/fotos.ts#detectarTipoPorMagicNumber`/`extrairDimensoes`,
 * que são puras e não sabem nada de S3.
 */
export async function lerInicioObjeto(chave: string): Promise<Buffer> {
  const resposta = await clienteS3.send(
    new GetObjectCommand({
      Bucket: nomeBucket(),
      Key: chave,
      Range: `bytes=0-${BYTES_LEITURA_VERIFICACAO - 1}`,
    }),
  );
  const bytes = (await resposta.Body?.transformToByteArray()) ?? new Uint8Array(0);
  return Buffer.from(bytes);
}

/**
 * `DELETE /api/admin/casas/{casaId}/fotos/{fotoId}` (UC-A03, ainda não
 * implementado) e E5 deste registro (RN13: magic number não corresponde ao
 * `Content-Type` → apaga o objeto). Esta função pode lançar — é quem chama
 * que decide tratar como best-effort (capturar e seguir, como
 * `docs/03-tecnico/07-armazenamento-de-imagens.md#exclusão-de-foto` pede:
 * "se a exclusão no S3 falhar, loga e segue — o objeto órfão não é
 * referenciado por nada") ou deixar propagar, conforme o contexto da rota.
 */
export async function apagarObjeto(chave: string): Promise<void> {
  await clienteS3.send(new DeleteObjectCommand({ Bucket: nomeBucket(), Key: chave }));
}
