# PriceIQ — Web (Frontend Next.js)

Frontend SaaS do PriceIQ — **Next.js 14 (App Router) + React 18 + TypeScript**.

**Preserva 100% a identidade visual do `index.html` original**: cores, espaçamentos, ícones, comportamentos.
A única coisa que mudou é a fonte dos dados: hoje vem do backend Fastify, não do `localStorage`.

## 📁 Estrutura

```
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                  Layout global (shell + toast)
│   │   ├── globals.css                 CSS extraído 1:1 do index.html
│   │   ├── page.tsx                    Tela Início (RateBar + SearchBox + recentes)
│   │   ├── suppliers/page.tsx          Tela Lojas (CRUD)
│   │   ├── history/page.tsx            Tela Histórico
│   │   ├── settings/page.tsx           Tela Config (cotações + sobre)
│   │   └── results/[searchId]/page.tsx Tela Resultados (polling 2.5s)
│   ├── components/
│   │   ├── PriceIQShell.tsx            Container global
│   │   ├── BottomNav.tsx               Nav superior (logo + 4 tabs)
│   │   ├── SearchBox.tsx               Campo + chips + botão Buscar
│   │   ├── SupplierChip.tsx            Chip selecionável
│   │   ├── SupplierCard.tsx            Card de fornecedor na tela Lojas
│   │   ├── ResultCard.tsx              Card de resultado expansível
│   │   ├── RateBar.tsx                 Barra de cotação USD/EUR/CNY
│   │   ├── ProgressSearch.tsx          Indicador de progresso
│   │   ├── Toast.tsx                   Toast singleton imperativo
│   │   └── Icons.tsx                   SVGs portados do `ico` original
│   └── lib/
│       ├── api.ts                      Cliente da API (suppliers/searches/rates)
│       ├── format.ts                   fmt, fmt4, fmtDate, rateAge
│       └── types.ts                    Tipos compartilhados com backend
├── next.config.mjs                     Rewrite /api/* → backend
├── tsconfig.json                       TS strict
├── .env.example                        NEXT_PUBLIC_API_URL
└── package.json
```

## 🚀 Como rodar (dev local / cloud)

```bash
# 1. Backend rodando primeiro (em outro terminal/serviço)
cd ../server
npm install && npm run db:seed && npm run dev   # http://localhost:3001

# 2. Frontend
cd ../web
cp .env.example .env       # opcional: ajustar NEXT_PUBLIC_API_URL
npm install
npm run dev                # http://localhost:3000
```

## 🌐 Deploy em cloud

### Vercel (recomendado para Next.js)
1. Conectar o repo no Vercel, apontar root para `web/`
2. Definir env var: `NEXT_PUBLIC_API_URL = https://<sua-api>.com`
3. Deploy

### Outros providers (Render/Railway/Fly)
- `npm install` → `npm run build` → `npm start`
- Definir `NEXT_PUBLIC_API_URL`

## 🛡️ Regras invioláveis

| Regra | Implementação |
|---|---|
| ✅ Preserva visual original | CSS extraído 1:1 + inline styles fielmente portados |
| ✅ Cores exatas | `#070B14` bg, `#1C2A3A` borders, `#00D4FF`/`#0066FF` accent, `#E8F0FE` text |
| ✅ Nav superior, não bottom | Componente chama-se `BottomNav.tsx` por spec mas é top sticky |
| ✅ Mobile-first | viewport meta + max-width: 700px nas pages |
| ✅ Gemini só no backend | `lib/api.ts` só chama `/api/*` — nada de Gemini direto |
| ✅ Sem localStorage como SaaS | tudo persiste via API → Postgres |
| ✅ Sem template genérico | Zero shadcn, zero Tailwind reset, zero dashboard padrão |

## 🔌 Endpoints consumidos

| Tela | Endpoints |
|---|---|
| Início | `GET /api/suppliers`, `GET /api/rates`, `GET /api/searches?limit=6` |
| Resultados | `POST /api/searches`, `GET /api/searches/:id`, `GET /api/searches/:id/results`, `GET /api/suppliers` |
| Lojas | `GET/POST/PUT/DELETE /api/suppliers` |
| Histórico | `GET /api/searches?limit=50` |
| Config | `GET /api/rates`, `POST /api/rates/refresh` |

## 🧪 Scripts

```bash
npm run dev          # next dev — http://localhost:3000
npm run build        # production build
npm run start        # serve build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
```

## 🛣️ Próximas etapas

- **Etapa 5** — Auth + multi-tenant (login, user_id em buscas/suppliers)
- **Etapa 6** — Deploy de produção + billing
- **Etapa 7** — PWA + notificações
