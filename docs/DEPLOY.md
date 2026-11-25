# Deployment readiness (NOT deployed — awaiting owner approval)

| Piece | Target | Config | Status |
|---|---|---|---|
| API | Render (free web service) | `render.yaml` | Ready; needs env: `STRIKE_CONFIRM_SECRET`, `STRIKE_SIGNER_KEK` (32-byte base64), `STRIKE_PUBLIC_ORIGIN`, `STRIKE_ALLOWED_ORIGINS`, optional `COINGECKO_DEMO_API_KEY`, `STRIKE_STT_URL`. |
| Companion | Vercel | `apps/companion/vercel.json` (root dir `apps/companion`) | `next build` passes locally; set `NEXT_PUBLIC_STRIKE_API`. |
| Glasses | Even Hub | `apps/glasses/app.json`, `pnpm pack:g2` → `strike-g2.ehpk` | Packs locally (sha256 in `evidence/g2-package/`). Update the `network` whitelist to the production API origin, rebuild with `VITE_STRIKE_API`, then `evenhub upload`. |
| Database | Postgres | `prisma/schema.prisma` | Schema validates; API still uses the in-memory store (state resets on restart). |
| STT | self-hosted | `services/stt/docker-compose.yml` | Not run; provider decision pending. |

Free tiers only; no paid services were used or configured.
