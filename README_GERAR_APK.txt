PRICEIQ — GERAR APK PELO CELULAR COM GITHUB ACTIONS

Esse método usa o celular para controlar tudo, mas quem compila o APK é o
GitHub Actions na nuvem.

PRÉ-REQUISITOS (uma vez):

  1. SaaS PriceIQ já hospedado:
     - Backend em Render (server/), com DATABASE_URL apontando para o Neon.
     - Frontend em Vercel (web/), com NEXT_PUBLIC_API_URL apontando para o
       Render.
     - Confirma que https://<seu-frontend>.vercel.app abre o app SaaS real
       (sem "CAPTURA ASSISTIDA", "Colar texto", "Colar link" ou "Manual").

  2. Configure no GitHub a URL pública do frontend:
     repo > Settings > Secrets and variables > Actions > New repository variable
       Name:  PRICEIQ_FRONTEND_URL
       Value: https://<seu-frontend>.vercel.app
     (Usar Variable ou Secret, ambos funcionam. NÃO COMMITE essa URL.)

PASSOS PARA GERAR O APK:

  1. Abra o GitHub no celular.
  2. Vá no repo > Actions.
  3. Selecione "Build Android APK".
  4. Toque em "Run workflow".
     - Branch: main
     - frontend_url: deixe vazio para usar a Variable/Secret, ou cole uma
       URL alternativa para sobrescrever só nesta execução.
  5. Espere terminar (~4 a 7 min).
  6. Abra a execução finalizada.
  7. Baixe o artifact "PriceIQ-debug-apk".
  8. Extraia o ZIP e instale o app-debug.apk no Android.

O QUE O APK FAZ:

  - Abre a URL do PRICEIQ_FRONTEND_URL como WebView remoto.
  - Tela offline (mostrada apenas quando não há Internet ainda) é um shell
    mínimo com "Carregando…". NUNCA é o index.html legado.

PROBLEMAS COMUNS:

  - Workflow falha com "PRICEIQ_FRONTEND_URL não está configurada":
    configure a variable no Settings > Secrets and variables > Actions.

  - Workflow falha com "ainda é o placeholder":
    a Variable contém "COLOQUE-AQUI…" em vez da URL real do Vercel.

  - App abre, mas mostra a tela legada (CAPTURA ASSISTIDA, Manual, etc):
    sua PRICEIQ_FRONTEND_URL está apontando para o GitHub Pages do legado
    (https://dornelasz.github.io/priceiq-app) em vez do Vercel SaaS. Troque
    para a URL do Vercel.

  - APK não instala:
    autorize "Fontes desconhecidas" no Android. Se persistir, renomeie
    app-debug.apk para PriceIQ.apk.

DOCUMENTAÇÃO COMPLETA:

  - DEPLOY_APK.md          (procedimento operacional completo)
  - docs/deployment-entrypoint.md  (qual é a entrada real do SaaS)
