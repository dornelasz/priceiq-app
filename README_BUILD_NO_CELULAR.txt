PRICEIQ — BUILD DO APK

⚠️ Este arquivo era a instrução do antigo PriceIQ single-file
   (versão Gemini, com Android Studio local). Esse fluxo NÃO é mais usado.

O APK do PriceIQ atual é gerado pelo GitHub Actions na nuvem e empacota
APENAS um wrapper Capacitor que abre a URL real do SaaS (web/) em Vercel.

Não é mais necessário:
  - Android Studio local
  - npm install local
  - npx cap add android local
  - Gemini API Key no app (Gemini foi removido da pesquisa)

Para gerar o APK hoje, siga:
  README_GERAR_APK.txt        (passo a passo pelo celular via GitHub Actions)
  DEPLOY_APK.md               (procedimento operacional completo)
  docs/deployment-entrypoint.md  (qual é a entrada real do SaaS)
