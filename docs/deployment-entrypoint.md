# Entrada real do PriceIQ

> Este documento existe para que ninguém — humano ou agente — confunda o
> **app legado** com o **SaaS atual** ao fazer deploy.

## Resumo de uma linha

| Camada | Onde mora no repo | Onde roda | URL pública |
|---|---|---|---|
| **App SaaS (frontend)** | `web/` (Next.js 14) | Vercel | `PRICEIQ_FRONTEND_URL` |
| **API SaaS (backend)** | `server/` (Fastify + Postgres) | Render | configurada via `NEXT_PUBLIC_API_URL` no Vercel |
| **APK Android** | `capacitor.config.json` + `.github/workflows/build-apk.yml` | gerado no GitHub Actions | abre `PRICEIQ_FRONTEND_URL` no WebView |
| **Legado** | `legacy/index.html` | só referência histórica | não é deployado |

## Regra inviolável

A entrada do PriceIQ em produção é **`web/`** (Next.js, hospedado em Vercel).
Nada que rode no celular do usuário pode abrir o `legacy/index.html` como
app principal. Em particular:

- ❌ O APK **não** pode empacotar `legacy/index.html`.
- ❌ O APK **não** pode apontar para `https://dornelasz.github.io/priceiq-app`.
- ❌ Não pode haver URL hardcoded de Vercel no `capacitor.config.json` commitado.
- ✅ A URL real é resolvida em build-time a partir de `PRICEIQ_FRONTEND_URL`.

## Como o sinal de "é o SaaS real" se manifesta

A UI do **SaaS real** (`web/`) **nunca** mostra:

- "CAPTURA ASSISTIDA"
- "Colar texto"
- "Colar link"
- "Manual"
- "Busca manual"

Se você vê qualquer um desses textos no app instalado, está rodando o
**legado** — algo no fluxo de deploy quebrou a regra acima.

A UI do **SaaS real** tem (entre outros): barra de cotação Investing.com
no topo, busca automática pelo Motor Universal V2, fornecedores
gerenciados em `/suppliers`, histórico em `/history`, e cotação ao vivo
em `/api/rates`.

## Como configurar `PRICEIQ_FRONTEND_URL`

Esta variável **não** vive no repositório. É configurada em:

**GitHub** (para o workflow de build do APK):

1. repo > Settings > Secrets and variables > Actions
2. New repository variable (ou secret — ambos funcionam)
3. Name: `PRICEIQ_FRONTEND_URL`
4. Value: `https://<seu-frontend>.vercel.app` (URL real do Vercel — sem barra no final)

Para sobrescrever apenas em uma execução do workflow, use o campo
"frontend_url" do `workflow_dispatch` ao clicar em "Run workflow".

## Como verificar antes de gerar o APK

1. Abra `https://<seu-frontend>.vercel.app` no navegador do celular.
2. Confirme que aparece a UI Next.js do SaaS (cotação no topo, busca
   automática) — e **não** o app legado.
3. Faça uma busca de teste. Os fornecedores devem responder com `validated`,
   `cached` ou `error: needs_supplier_setup` (todos status do Motor V2 da
   Fase E). Nenhuma tela de "Colar texto" ou "Captura assistida" deve aparecer.
4. Só então rode o workflow `Build Android APK`.

## Para que serve o `legacy/index.html`

Apenas referência histórica. Era o PriceIQ single-file original (Gemini +
captura manual). Foi preservado em `legacy/` para que ninguém perca o que
existia, mas **não** é caminho do deploy:

- Não é servido pelo `server/`.
- Não é empacotado pelo APK.
- Não é o que `https://<seu-frontend>.vercel.app` serve.

A página `index.html` na **raiz** do repo agora é apenas um aviso de
deprecação — para o caso de alguém acessar `https://dornelasz.github.io/priceiq-app`
e achar que aquilo ainda é o app.

## Como verificar que está tudo certo

```bash
# 1. capacitor.config.json no repo tem token, não URL real
grep '__PRICEIQ_FRONTEND_URL__' capacitor.config.json

# 2. Workflow valida a env antes de buildar
grep 'PRICEIQ_FRONTEND_URL' .github/workflows/build-apk.yml

# 3. Não há referência ao index.html legado no fluxo de APK
grep -n 'legacy/index.html' .github/workflows/build-apk.yml || echo "✓ workflow não usa o legado"

# 4. Web build passa
cd web && npm run build
```
