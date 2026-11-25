# Reused code & third-party disclosure

No code from HELM, FUSE or any earlier project was reused. All STRIKE source in this repository was written for this hackathon.

## Third-party libraries (npm, used as dependencies — not vendored)

| Package | Used for | License |
|---|---|---|
| @evenrealities/even_hub_sdk 0.0.16 | G2 bridge (containers, images, events, audio) | per package |
| @evenrealities/evenhub-cli, @evenrealities/evenhub-simulator | packaging `.ehpk`, official simulator | per package |
| viem | EIP-712 / message signing & verification, keys | MIT |
| @msgpack/msgpack | Hyperliquid action hashing | ISC |
| decimal.js | exact price/size math | MIT |
| fflate | zlib for PNG encoding of G2 frames | MIT |
| fastify, @fastify/cors, @fastify/helmet | API server | MIT |
| zod | request validation | MIT |
| ws | WebSocket client | MIT |
| next, react, react-dom | companion | MIT |
| tailwindcss, @tailwindcss/postcss | companion styles | MIT |
| vite, typescript, tsx | build tooling | MIT / Apache-2.0 |
| vitest, @playwright/test | tests | MIT / Apache-2.0 |
| prisma | schema validation | Apache-2.0 |

## Fonts

- **Press Start 2P** by CodeMan38 — SIL Open Font License 1.1. Rasterised at its native 8 px grid into `packages/visual-engine/src/font.ts` by `scripts/gen-bitmap-font.py`.
- Companion web fonts via `next/font/google`: Instrument Serif, Inter Tight, JetBrains Mono — SIL OFL 1.1.

## Reference material (read, not copied)

- `hyperliquid-python-sdk` (MIT): used only to **generate test vectors** (`scripts/gen-hl-signing-fixtures.py` → `packages/hyperliquid/src/fixtures/python-sdk-signing.json`) with a throwaway, publicly-known test key (`0x0123…0123`). The TypeScript signing implementation is original.
- Even Hub templates (`evenhub-templates`): event-decoding pattern (CLICK = 0 omitted by protobuf) follows the documented approach; no files copied.
