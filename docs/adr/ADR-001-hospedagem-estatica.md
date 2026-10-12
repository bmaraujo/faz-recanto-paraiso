# ADR-001 — Site estático em S3 + CloudFront

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-11 |
| **Origem** | Mantido da especificação inicial |

## Contexto

O site precisa ser rápido no celular com sinal ruim (área rural, visitantes em 3G),
ter SEO bom (o tráfego orgânico é o que substitui a comissão do Airbnb) e custar
praticamente nada.

Restrição central do projeto: **até US$ 3/mês na AWS**.

## Alternativas

| Opção | Custo/mês | SEO | Prós | Contras |
|---|---|---|---|---|
| **S3 + CloudFront** | ~US$ 0,10 | Excelente | HTTPS grátis, CDN global, escala sem configuração | Precisa de pipeline de build; sem renderização no servidor |
| EC2 / Lightsail | US$ 5-10 | Excelente | Flexível, SSR | Custo fixo, patch de SO, backup, risco de segurança |
| Vercel / Netlify (free) | US$ 0 | Excelente | Deploy trivial, DX ótima | Free tier pode mudar; dado fora da AWS; menos controle |
| Amplify Hosting | ~US$ 1-5 | Excelente | Integrado à AWS | Cobra por build e por GB; abstração que esconde o CloudFront |
| S3 estático sem CloudFront | ~US$ 0,05 | Bom | O mais simples | **Sem HTTPS em domínio próprio** — inaceitável |
| WordPress gerenciado | US$ 15-30 | Bom | Pronto, admin conhecido | Custo, plugins, manutenção, performance |

## Decisão

**S3 privado + CloudFront com OAC**, site gerado estaticamente pelo Astro.

Razões, em ordem:

1. **Custo**: no free tier do CloudFront, o tráfego previsto custa zero.
2. **Performance**: HTML estático em CDN é o teto do que se pode entregar no 3G.
3. **Segurança**: nenhum servidor para invadir, nenhum SO para atualizar.
4. **Controle**: cabeçalhos, cache e roteamento configurados explicitamente, em IaC.
5. **Sem lock-in de plataforma**: o S3 é um bucket; migrar é copiar arquivos.

Configuração: bucket com `BlockPublicAccess.BLOCK_ALL`, acesso só pelo CloudFront via
**OAC** (Origin Access Control, não o OAI legado), `enforceSSL`, SSE-S3.

## Consequências

### Positivas
- Custo de hospedagem desprezível e previsível.
- Lighthouse ≥ 90 é alcançável sem esforço heroico.
- Escala para qualquer pico sem configuração.
- Nenhuma superfície de ataque de servidor.
- Cabeçalhos de segurança e política de cache centralizados.

### Negativas
- **Sem renderização no servidor.** Conteúdo dinâmico exige API (que já existe) ou
  rebuild ([ADR-009](./ADR-009-conteudo-no-banco-com-publicacao.md)).
- **Deploy de CloudFront é lento** (~15 min). Mudança de configuração não é iterativa.
- Rotas sem extensão exigem uma CloudFront Function para reescrever para `index.html`.
- Invalidação de cache tem cota (1.000 caminhos/mês grátis) — obriga a invalidar por
  prefixo.
- O bucket não tem versionamento (custo), o que torna um `s3 sync --delete` mal escrito
  destrutivo. Mitigado por `--exclude` obrigatório e teste de deploy; **vale
  reconsiderar** ligar o versionamento por ~US$ 0,01/mês.

### O que fica mais difícil
- Personalização por visitante (não há — e não é requisito).
- A/B testing (exigiria CloudFront Functions com lógica, ou nada).
- Conteúdo que muda a cada minuto (resolvido pela API, não pelo site estático).

## Quando revisar

| Gatilho | Reconsiderar |
|---|---|
| Egress > 50 GB/mês | Compressão de imagem; avaliar o custo real |
| Reclamação de latência no Brasil | `PRICE_CLASS_ALL` (inclui São Paulo) |
| Necessidade real de SSR | Astro com adaptador de Lambda, ou CloudFront + Lambda |
| Perda de fotos por `--delete` | Ligar o versionamento do bucket |
