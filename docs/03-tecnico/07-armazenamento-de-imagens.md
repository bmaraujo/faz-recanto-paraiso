# 07 — Armazenamento de imagens

As fotos são o conteúdo mais importante do site — é o que vende a casa — e também o
maior risco de custo (tráfego) e de performance (Lighthouse).

## Decisão: redimensionar no navegador, guardar no S3, servir pelo CloudFront

```
Admin escolhe o arquivo (pode ser um JPEG de 8 MB do celular)
        │
        ▼
Navegador (SPA do admin):
  1. valida tipo e tamanho
  2. lê as dimensões
  3. redimensiona em <canvas> para no máximo 1600 px no lado maior
  4. converte para WebP com qualidade 0,82
  5. resultado típico: 120–250 KB
        │
        ▼
POST /api/admin/casas/{casaId}/fotos/upload
  → devolve um presigned POST do S3 com condições
        │
        ▼
Navegador faz POST multipart direto ao S3 (não passa pela Lambda)
        │
        ▼
POST /api/admin/casas/{casaId}/fotos
  → registra a foto no item da casa (legenda, texto alternativo, ordem)
```

### Por que no navegador e não em uma Lambda com `sharp`

| Critério | Navegador (`canvas`) | Lambda + `sharp` |
|---|---|---|
| Custo | **Zero** | Lambda de 1 GB por alguns segundos por foto — centavos, mas não zero |
| Complexidade | ~60 linhas de JS | Layer ou bundle nativo, trigger S3, tratamento de falha, retentativa |
| Qualidade | Boa (suficiente para 1600 px) | Melhor (controle fino, AVIF, múltiplos tamanhos) |
| Velocidade percebida | Upload de 200 KB em vez de 8 MB — **muito mais rápido** no celular | Upload lento, processamento depois |
| Risco | Depende do navegador do admin | Nenhum |

O fator decisivo é o terceiro: o administrador vai subir fotos **pelo celular, em
área rural, com sinal ruim**. Subir 200 KB em vez de 8 MB é a diferença entre
funcionar e desistir.

**Trade-off aceito:** a Lambda não re-processa a imagem, então o servidor **não pode
confiar** nas dimensões informadas pelo cliente. Mitigação na próxima seção.

**Gatilho de revisão:** se o proprietário quiser AVIF, múltiplas resoluções por foto
(`srcset` real) ou marca d'água, aí sim vale uma Lambda com `sharp` acionada por evento
do S3. Fica anotado como melhoria, não como requisito.

## O que o servidor valida (porque o cliente não é confiável)

O navegador é um auxiliar de UX. O servidor impõe:

### No presigned POST (`POST .../fotos/upload`)

```
Condições da policy do S3:
  bucket fixo
  key com prefixo exato: midia/casas/<casaId>/
  content-length-range: 1 .. 3145728        (1 B a 3 MB)
  Content-Type exatamente igual ao solicitado, de uma allowlist
  expiração: 5 minutos
```

| Validação | Onde |
|---|---|
| `Content-Type` ∈ `image/webp`, `image/jpeg`, `image/png` | Lambda, antes de assinar |
| Extensão coerente com o `Content-Type` | Lambda |
| Tamanho ≤ 3 MB | **Condição da policy** — imposta pelo S3, não pela Lambda |
| Caminho | **Condição da policy** — o cliente não escolhe onde grava |
| Casa existe e pertence à instalação | Lambda |
| Limite de 40 fotos na casa | Lambda |

> **Presigned POST, não presigned PUT.** O PUT assinado não permite condição de
> `content-length-range` — um cliente malicioso subiria um arquivo de 5 GB. O POST
> com policy permite. Essa é a razão técnica da escolha e não deve ser "simplificada"
> depois.

### No registro (`POST .../fotos`)

```
1. HeadObject na chave informada
     → objeto existe?            → 400 se não
     → ContentLength <= 3 MB?    → 400 se não
     → ContentType na allowlist? → 400 se não
2. Lê os primeiros 32 bytes do objeto e confere a MAGIC NUMBER
     WebP: "RIFF" + 4 bytes + "WEBP"
     JPEG: FF D8 FF
     PNG:  89 50 4E 47 0D 0A 1A 0A
   → não casa com o Content-Type? → 400 ARQUIVO_INVALIDO e apaga o objeto
3. Extrai largura/altura do header da própria imagem (não confia no cliente)
4. Grava a foto no item da casa
```

O passo 2 é o que impede alguém de subir um HTML ou um SVG com `Content-Type:
image/webp` e obter um arquivo servido pelo nosso domínio. Combinado com
`X-Content-Type-Options: nosniff` e um `Content-Security-Policy` que não permite
script de `/midia/*`, o risco fica fechado.

> **SVG não é aceito.** SVG é um documento XML que pode conter `<script>`.
> Para fotos de casa, não há caso de uso. Se um dia precisar (ícones), use um
> pipeline separado com sanitização dedicada.

## Nomes de arquivo e cache

```
midia/casas/<casaId>/<fotoId>-<slug-da-legenda>-<6 hex aleatórios>.webp
```

Exemplo: `midia/casas/01HQ8X.../01HQ9A-fachada-vista-do-lago-a3f9c1.webp`

| Parte | Função |
|---|---|
| `casaId` | Agrupa por casa; facilita apagar tudo ao remover a casa |
| `fotoId` (ULID) | Identificador estável da foto |
| slug da legenda | **SEO de imagem** — o Google lê o nome do arquivo |
| 6 hex aleatórios | Torna a chave imprevisível e permite cache imutável |

Como a chave nunca é reutilizada, o CloudFront pode cachear com
`Cache-Control: public, max-age=31536000, immutable` e **nunca** precisa de
invalidação para imagens. Trocar uma foto = nova chave + atualizar o item da casa.

## Bucket e permissões

Um **único bucket** serve o site e as mídias:

```
s3://recanto-paraiso-site-<stage>/
├─ index.html, assets/...        (build do Astro)
├─ _dados/casas.json             (dados públicos publicados)
└─ midia/casas/<casaId>/...      (fotos)
```

| Configuração | Valor |
|---|---|
| Acesso público | **Bloqueado** (`BlockPublicAccess.BLOCK_ALL`) |
| Acesso do CloudFront | **OAC** (Origin Access Control), somente `s3:GetObject` |
| Versionamento | Desligado (custo; o conteúdo é regenerável e as fotos ficam no item da casa) |
| Criptografia | SSE-S3 (grátis) |
| TLS obrigatório | Policy com `aws:SecureTransport: false` → `Deny` |
| Lifecycle | `AbortIncompleteMultipartUpload` após 7 dias |

Permissões da `api-admin` no bucket: `s3:PutObject` **restrito ao prefixo
`midia/casas/*`**, mais `s3:GetObject`, `s3:DeleteObject` e `s3:HeadObject` no mesmo
prefixo. Nada de `s3:*` nem acesso à raiz do bucket — a Lambda de admin não pode
sobrescrever `index.html`.

> Um único bucket em vez de dois é uma escolha de simplicidade e custo (uma origem,
> uma distribuição, um OAC). O isolamento vem da **política de IAM por prefixo**, não
> da separação física.

## Exclusão de foto

```
1. Remove a foto do array no item da casa (escrita condicional no fotoId)
2. Apaga o objeto no S3
3. Se o passo 2 falhar, loga e segue — o objeto órfão não é referenciado por nada
```

Ordem deliberada: primeiro o banco, depois o S3. Um objeto órfão no S3 custa frações
de centavo e é invisível; uma referência no banco para um objeto inexistente produz
uma imagem quebrada no site.

Faxina de órfãos: tarefa opcional no `cron-diario`, comparando o prefixo do S3 com as
chaves referenciadas. Só vale a pena se o volume crescer.

## Entrega no frontend

```html
<img
  src="/midia/casas/01HQ.../01HQ9A-fachada-a3f9c1.webp"
  width="1600" height="1067"
  alt="Casa de madeira com varanda, vista do lago ao fundo"
  loading="lazy" decoding="async"
/>
```

| Técnica | Por quê |
|---|---|
| `width`/`height` explícitos | Elimina layout shift — peso direto no Lighthouse (CLS) |
| `loading="lazy"` em tudo **menos** a primeira imagem | A primeira é o LCP e deve ser `eager` com `fetchpriority="high"` |
| `decoding="async"` | Não bloqueia o render |
| `alt` obrigatório | Acessibilidade e SEO. **Campo obrigatório no backoffice** |
| WebP sem `<picture>` | Suporte universal nos navegadores atuais; um formato só mantém simples |

O `textoAlternativo` é **obrigatório** no cadastro da foto. Sem ele, o Lighthouse de
acessibilidade não passa de 90, que é um critério de aceite. A legenda (`legenda`) é
separada e opcional — aparece no lightbox.

## Custo

| Item | Estimativa |
|---|---|
| Armazenamento | 10 casas × 40 fotos × 200 KB = **80 MB** → ~US$ 0,002/mês |
| `PUT` de upload | Centenas por mês → desprezível |
| Tráfego | Servido pelo CloudFront, dentro do free tier de egress |
| Processamento | **Zero** (feito no navegador) |

Praticamente gratuito. O que poderia custar é tráfego, e é o que a compressão para
~200 KB e o cache de um ano resolvem.

## Casos de teste

| # | Cenário | Esperado |
|---|---|---|
| 1 | Upload de 5 MB após o redimensionamento falhar no cliente | S3 rejeita pela policy (`content-length-range`) |
| 2 | Presigned com caminho alterado pelo cliente | S3 rejeita pela condição de prefixo |
| 3 | HTML renomeado para `.webp` com `Content-Type: image/webp` | Registro rejeitado na verificação de magic number; objeto apagado |
| 4 | SVG | Rejeitado no `Content-Type` |
| 5 | Registro com chave inexistente | `400` |
| 6 | 41ª foto | `422 LIMITE_FOTOS` |
| 7 | Marcar uma foto como principal | As outras ficam `principal: false` na mesma escrita |
| 8 | Cadastro sem `textoAlternativo` | `400 ENTRADA_INVALIDA` |
| 9 | Excluir foto | Removida do item; objeto apagado |
| 10 | Excluir foto com falha no S3 | Item atualizado; erro logado; resposta de sucesso |
| 11 | Reordenar fotos | Nova ordem persistida; nenhuma foto perdida |
| 12 | Presigned expirado (6 min) | S3 rejeita |
| 13 | Política de IAM da `api-admin` | Não consegue escrever em `index.html` |
