# UC-A03 — Gerenciar fotos de uma casa

| Campo | Valor |
|---|---|
| Ator | Administrador |
| Pré-condições | Autenticado; casa existente |
| Gatilho | O admin abre a aba "Fotos" de uma casa |
| Fase | 1 |
| Relacionados | [07 — Imagens](../../03-tecnico/07-armazenamento-de-imagens.md), [UC-A02](./UC-A02-gerenciar-casas.md), [UC-A14](./UC-A14-publicar-site.md) |

## Objetivo de negócio

As fotos são o que vende. O proprietário precisa poder trocá-las sozinho, **pelo
celular, depois de fotografar a casa**, sem depender de ninguém e sem gastar o pacote
de dados subindo 8 MB por imagem.

É o UC com maior impacto direto em conversão e o mais exigente em experiência mobile.

## Fluxo principal

1. O admin abre a aba "Fotos" e vê a grade das fotos atuais, na ordem de exibição.
2. Clica em **"Adicionar fotos"** e escolhe uma ou várias imagens (ou tira uma na hora,
   pela câmera).
3. Para **cada** imagem, o navegador:
   1. valida tipo e tamanho;
   2. redimensiona para no máximo 1600 px no lado maior;
   3. converte para WebP (qualidade 0,82);
   4. mostra a miniatura com a barra de progresso.
4. Pede o presigned POST: `POST /api/admin/casas/{casaId}/fotos/upload`.
5. Envia o arquivo **direto ao S3**, sem passar pela Lambda.
6. Registra a foto: `POST /api/admin/casas/{casaId}/fotos`, com a chave, a legenda e o
   texto alternativo.
7. A foto aparece na grade.
8. O admin preenche o **texto alternativo** (obrigatório), a legenda (opcional),
   reordena arrastando e escolhe a foto principal.
9. Publica o site para que as mudanças apareçam ([UC-A14](./UC-A14-publicar-site.md)).

## Fluxos alternativos

| # | Situação | Comportamento |
|---|---|---|
| A1 | Várias fotos de uma vez | Processadas e enviadas com concorrência **2** (não todas em paralelo — travaria o celular) |
| A2 | Admin usa a câmera do celular | `<input type="file" accept="image/*" capture="environment">` |
| A3 | Admin reordena | Arrastar-e-soltar; salva a nova ordem em uma chamada |
| A4 | Admin define a foto principal | A anterior é desmarcada na mesma escrita |
| A5 | Admin edita legenda/texto alternativo | Salvamento por campo, ao sair do foco |
| A6 | Admin exclui uma foto | Confirmação; remove do item e apaga do S3 |
| A7 | Imagem já é WebP e pequena | Pula o redimensionamento |
| A8 | Imagem na orientação errada (EXIF) | O redimensionamento **aplica a rotação do EXIF** antes de converter |

> A8 é um detalhe que parece pequeno e não é: fotos de celular trazem a rotação no
> EXIF. Desenhar no `<canvas>` **descarta** o EXIF, então sem tratar a orientação
> explicitamente todas as fotos em retrato aparecem deitadas no site.

## Fluxos de exceção

| # | Situação | Resposta | O que o admin vê |
|---|---|---|---|
| E1 | Arquivo não é imagem | — | Rejeitado no cliente, antes do upload |
| E2 | Arquivo acima de 20 MB | — | "Esta imagem é muito grande. Tente outra." (barrado no cliente) |
| E3 | Após redimensionar ainda passa de 3 MB | S3 rejeita | "Não conseguimos processar esta imagem." |
| E4 | Chave manipulada pelo cliente | S3 rejeita pela policy | Erro genérico de upload |
| E5 | Arquivo não é imagem de verdade (magic number) | `400 ARQUIVO_INVALIDO` | "Este arquivo não é uma imagem válida." Objeto apagado do S3 |
| E6 | 41ª foto | `422 LIMITE_FOTOS` | "Limite de 40 fotos por casa." |
| E7 | Texto alternativo vazio ao salvar | `400` | Campo marcado; a foto fica na grade com aviso |
| E8 | Falha de rede no meio do upload | — | Aquela foto marcada como "falhou" com botão de tentar novamente; **as outras continuam** |
| E9 | Presigned expirado (> 5 min) | S3 rejeita | Tenta novamente obtendo novo presigned, automaticamente, uma vez |
| E10 | Exclusão falha no S3 | `200` | Foto removida da grade; erro apenas logado |
| E11 | Excluir a foto principal | `200` | A primeira da ordem vira principal automaticamente |
| E12 | Navegador sem suporte a WebP no canvas | — | Cai para JPEG qualidade 0,85 |

> **E8 é o requisito de experiência mais importante deste UC.** Subir 15 fotos com
> sinal ruim e perder tudo porque a 12ª falhou é inaceitável. Cada upload é
> independente e tem sua própria tentativa.

## Regras de negócio

| # | Regra |
|---|---|
| RN1 | Máximo de **40** fotos por casa |
| RN2 | Formatos aceitos: WebP, JPEG, PNG. **SVG não é aceito** |
| RN3 | Tamanho máximo após processamento: 3 MB (imposto pela policy do S3) |
| RN4 | Dimensão máxima: 1600 px no lado maior |
| RN5 | `textoAlternativo` é **obrigatório** (acessibilidade e SEO) |
| RN6 | `legenda` é opcional |
| RN7 | Exatamente uma foto `principal` por casa (no máximo) |
| RN8 | A foto principal é a primeira da galeria e a imagem de Open Graph |
| RN9 | Ao excluir a principal, a primeira da ordem assume |
| RN10 | A chave no S3 inclui sufixo aleatório → cache imutável de 1 ano |
| RN11 | A chave fica sempre sob `midia/casas/<casaId>/` |
| RN12 | Toda alteração marca `publicacaoPendente = true` |
| RN13 | O servidor **verifica o magic number** do arquivo antes de registrar |
| RN14 | O servidor extrai largura e altura da própria imagem, sem confiar no cliente |
| RN15 | A ordem é um inteiro; reordenar reescreve as ordens de 10 em 10 |

> RN15: espaçar as ordens de 10 em 10 (10, 20, 30...) permite inserir uma foto no meio
> sem reescrever todas. Detalhe pequeno que simplifica o arrastar-e-soltar.

## Contrato técnico

### `POST /api/admin/casas/{casaId}/fotos/upload`

```json
{ "contentType": "image/webp", "nomeOriginal": "fachada.jpg", "bytes": 184320 }
```

Resposta `200`:

```json
{
  "chave": "midia/casas/01HQ.../01HR9A-a3f9c1.webp",
  "url": "https://<bucket>.s3.amazonaws.com/",
  "campos": {
    "key": "midia/casas/01HQ.../01HR9A-a3f9c1.webp",
    "Content-Type": "image/webp",
    "policy": "...",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": "...",
    "x-amz-date": "...",
    "x-amz-signature": "..."
  },
  "expiraEm": "2026-10-11T18:09:00-03:00"
}
```

Condições da policy: prefixo exato, `content-length-range: 1..3145728`,
`Content-Type` exato, expiração de 5 min. Ver
[07 — Imagens](../../03-tecnico/07-armazenamento-de-imagens.md).

### `POST /api/admin/casas/{casaId}/fotos`

```json
{
  "chave": "midia/casas/01HQ.../01HR9A-a3f9c1.webp",
  "textoAlternativo": "Casa de madeira com varanda, vista do lago ao fundo",
  "legenda": "Fachada vista do lago",
  "principal": false
}
```

O servidor faz `HeadObject`, verifica o magic number, extrai as dimensões e grava.
Resposta `201` com a foto registrada.

### Outras rotas

| Rota | Corpo |
|---|---|
| `PUT .../fotos/ordem` | `{ "ordem": ["fotoId1", "fotoId2", ...] }` |
| `PUT .../fotos/{fotoId}` | `{ "textoAlternativo", "legenda", "principal" }` |
| `DELETE .../fotos/{fotoId}` | — |

### Erros

| Código | HTTP |
|---|---|
| `ENTRADA_INVALIDA` | 400 |
| `ARQUIVO_INVALIDO` | 400 |
| `NAO_ENCONTRADO` | 404 |
| `LIMITE_FOTOS` | 422 |
| `TIPO_NAO_SUPORTADO` | 422 |

## Implementação

### Redimensionamento no navegador

```ts
// site/src/lib/imagem.ts
const MAX_LADO = 1600;
const QUALIDADE = 0.82;

export async function prepararImagem(arquivo: File): Promise<Blob> {
  // createImageBitmap respeita a orientação do EXIF — ver fluxo A8
  const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = new OffscreenCanvas(largura, altura);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();                                   // libera memória no celular

  return canvas.convertToBlob({ type: "image/webp", quality: QUALIDADE });
}
```

| Detalhe | Por quê |
|---|---|
| `imageOrientation: "from-image"` | Aplica a rotação do EXIF (fluxo A8) |
| `OffscreenCanvas` | Não bloqueia o thread principal; a interface continua responsiva |
| `bitmap.close()` | Imagens de celular são grandes; sem liberar, o Safari no iPhone trava |
| Concorrência 2 | Processar 15 imagens em paralelo esgota a memória do celular |
| Fallback | Sem `OffscreenCanvas`/WebP, usa `<canvas>` + JPEG |

### Verificação do magic number no servidor

```ts
const ASSINATURAS: Array<[string, (b: Buffer) => boolean]> = [
  ["image/webp", (b) => b.subarray(0, 4).toString() === "RIFF" &&
                        b.subarray(8, 12).toString() === "WEBP"],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png",  (b) => b.subarray(0, 8).equals(
                          Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))],
];
```

Lê os primeiros 32 bytes com `GetObject` e `Range: bytes=0-31`. Se não casar com o
`Content-Type` declarado: apaga o objeto e responde `400 ARQUIVO_INVALIDO`.

### Armadilhas

1. **Presigned POST, não PUT.** Só o POST com policy impõe `content-length-range`.
   Com PUT assinado, um cliente sobe um arquivo de qualquer tamanho.
2. **EXIF.** Ver A8. Sem `imageOrientation`, metade das fotos sai deitada.
3. **Memória no celular.** `bitmap.close()` e concorrência 2 são obrigatórios.
4. **Não confiar nas dimensões do cliente.** O servidor extrai do header da imagem.
5. **Foto principal exclusiva.** Marcar uma precisa desmarcar as outras **na mesma
   escrita** do item da casa, senão duas ficam principais.
6. **`publicacaoPendente`.** Trocar foto sem marcar isso faz o admin publicar e não
   ver mudança — e concluir que o sistema está quebrado.
7. **Nunca aceitar SVG.** É XML executável. Para fotos de casa não há caso de uso.
8. **Uploads independentes.** Um `Promise.all` que rejeita no primeiro erro perde o
   lote inteiro; use `Promise.allSettled` com estado por arquivo.

## Interface

```
Fotos da Casa do Lago                     12 de 40
┌─────────────────────────────────────────────────────────┐
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│ │ ★ PRIN │ │        │ │        │ │ ⟳ 64%  │            │
│ │ [foto] │ │ [foto] │ │ [foto] │ │        │            │
│ │ Fachada│ │ Varanda│ │ ⚠ falta│ │        │            │
│ │   ⋮    │ │   ⋮    │ │  texto │ │        │            │
│ └────────┘ └────────┘ └────────┘ └────────┘            │
│                                                          │
│         [ + Adicionar fotos ]    [ 📷 Tirar foto ]       │
└─────────────────────────────────────────────────────────┘
Arraste para reordenar. A primeira foto (★) aparece em destaque.
```

| Estado | Comportamento |
|---|---|
| Processando | Miniatura com indicador; "Preparando imagem..." |
| Enviando | Barra de progresso real do upload |
| Falhou | Borda de erro + botão "Tentar novamente" **naquela foto** |
| Sem texto alternativo | Aviso visível no cartão; bloqueia a ativação da casa |
| Reordenando | Arrastar-e-soltar com feedback; salva ao soltar |
| Excluindo | Confirmação com a miniatura da foto |

Acessibilidade do reordenamento: além de arrastar, oferecer botões "mover para a
esquerda/direita" — arrastar-e-soltar sozinho não é operável por teclado.

### Ajuda contextual sobre o texto alternativo

O admin não técnico não sabe o que é "texto alternativo". O campo precisa de rótulo
em linguagem comum e um exemplo:

```
Descreva a foto (para pessoas com deficiência visual e para o Google) *
[Casa de madeira com varanda, vista do lago ao fundo_______________]
Exemplo: "Quarto com cama de casal e janela voltada para a mata"
```

## Segurança e privacidade

| Risco | Mitigação |
|---|---|
| Upload de arquivo arbitrário | `Content-Type` em allowlist + **magic number** verificado + SVG proibido |
| Upload gigante (DoS de custo) | `content-length-range` na policy do S3 |
| Escrita fora do prefixo | Condição de prefixo na policy; IAM da Lambda restrito a `midia/casas/*` |
| Sobrescrever `index.html` | Impossível: IAM por prefixo |
| Conteúdo ativo servido do nosso domínio | `nosniff` + CSP que não permite script em `/midia/*` |
| Presigned reutilizado | Expira em 5 min; chave única por upload |
| Metadados EXIF com GPS | O redimensionamento no `<canvas>` **descarta todo o EXIF**, inclusive coordenadas — efeito colateral desejável de privacidade |

> O descarte do EXIF é um ganho real: fotos de celular carregam a localização exata.
> Publicá-las com GPS embutido revelaria o endereço que [UC-A02](./UC-A02-gerenciar-casas.md) RN11
> protege.

## Critérios de aceite

- [ ] Upload de JPEG de 8 MB resulta em arquivo WebP de ~200 KB no S3.
- [ ] Foto em retrato (EXIF) aparece na orientação correta.
- [ ] Upload de 10 fotos com uma falha: as outras 9 concluem.
- [ ] Foto que falhou pode ser reenviada individualmente.
- [ ] Arquivo HTML com `Content-Type: image/webp` é rejeitado e o objeto apagado.
- [ ] SVG rejeitado.
- [ ] 41ª foto retorna `422`.
- [ ] Texto alternativo obrigatório.
- [ ] Marcar principal desmarca a anterior.
- [ ] Excluir a principal promove a primeira da ordem.
- [ ] Reordenar persiste e é operável por teclado.
- [ ] Excluir remove do item e do S3.
- [ ] Falha no S3 ao excluir não impede a remoção da grade.
- [ ] Qualquer alteração marca `publicacaoPendente`.
- [ ] A chave é sempre sob `midia/casas/<casaId>/`.
- [ ] O EXIF é descartado (nenhuma coordenada GPS no arquivo publicado).
- [ ] Upload de 15 fotos no celular não travar a interface.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | JPEG 4000×3000 de 8 MB | WebP 1600×1200, ~200 KB |
| 2 | Foto com EXIF de rotação 6 | Orientação correta |
| 3 | PNG com transparência | Convertido; fundo tratado |
| 4 | WebP 800×600 de 90 KB | Enviado sem reprocessar |
| 5 | Arquivo de 25 MB | Rejeitado no cliente |
| 6 | PDF renomeado para `.webp` | `400 ARQUIVO_INVALIDO`; objeto apagado |
| 7 | SVG | `422 TIPO_NAO_SUPORTADO` |
| 8 | Chave alterada para `index.html` | S3 rejeita |
| 9 | 41ª foto | `422 LIMITE_FOTOS` |
| 10 | Registrar sem texto alternativo | `400` |
| 11 | Marcar segunda foto como principal | Primeira desmarcada |
| 12 | Excluir a principal entre 3 fotos | A próxima da ordem vira principal |
| 13 | Excluir a única foto de casa `ATIVA` | Permitido; a casa fica incompleta e a publicação bloqueia |
| 14 | Reordenar 12 fotos | Ordem persistida, nenhuma perdida |
| 15 | Presigned usado após 6 min | S3 rejeita; novo presigned obtido automaticamente |
| 16 | 10 uploads com a 5ª falhando | 9 sucessos, 1 com botão de tentar novamente |
| 17 | Excluir com falha no S3 | Foto fora da grade; erro logado; `200` |
| 18 | Qualquer alteração | `publicacaoPendente: true` |
| 19 | EXIF do arquivo publicado | Nenhum metadado, nenhum GPS |
| 20 | IAM da `api-admin` | Não consegue `PutObject` fora de `midia/casas/*` |
