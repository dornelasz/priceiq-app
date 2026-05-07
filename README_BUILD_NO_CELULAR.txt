PRICEIQ — GERAR APK PELO CELULAR COM GITHUB ACTIONS

Esse método usa o celular para controlar tudo, mas quem compila o APK é o GitHub na nuvem.

PASSOS:
1. No celular, crie uma conta no GitHub ou entre na sua conta.
2. Crie um novo repositório chamado priceiq-app.
3. Extraia este ZIP no celular ou envie os arquivos do ZIP para o repositório.
4. Confirme que o repositório contém:
   - package.json
   - capacitor.config.json
   - www/index.html
   - .github/workflows/build-apk.yml
5. No GitHub, abra a aba Actions.
6. Escolha Build Android APK.
7. Toque em Run workflow.
8. Espere terminar.
9. Abra a execução finalizada.
10. Baixe o artifact chamado PriceIQ-debug-apk.
11. Extraia se vier em ZIP.
12. Instale o app-debug.apk no Android.
13. Abra o app, vá em Configurações e cole a Gemini API Key.

OBSERVAÇÃO:
- Para repositório público, o GitHub Actions costuma ser grátis em runners padrão.
- Para repositório privado, depende da cota grátis da conta.
- Se o APK não instalar, renomeie app-debug.apk para PriceIQ.apk e tente novamente.
