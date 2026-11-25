# Security model

## Money-movement boundaries
- **Mainnet signing is impossible in code**, enforced in three places and tested: `assertSigningAllowed` (`@strike/shared`) throws for any env ≠ testnet; `signL1Action` / `approveAgentTypedData` call it; `TestnetExchangeClient` refuses mainnet env and any `api.hyperliquid.xyz` URL.
- Allow-listed actions only: `order, cancel, cancelByCloid, updateLeverage, modify, batchModify`. No withdraw, transfer, bridge, vault, or builder-fee code paths exist. Builder fields are rejected.
- No automation: Sentinel only alerts; every order requires preview → explicit confirm.

## Confirmation
- Preview creates a proposal with a sha256 hash and an HMAC-signed, **single-use** confirm token (30 s). Claim happens before any side effect; duplicate → `REPLAYED`, other user → `WRONG_USER`, expired → `EXPIRED`, risk failed → `RISK_FAILED`.
- Confirm re-fetches a fresh book and re-runs precision + risk; material change → re-preview.
- Transport failure after submit → `UNKNOWN`, reconcile via `orderStatus` by `cloid`; never auto-retried.
- Voice can never confirm (grammar returns `confirm-refused`).

## Identity & sessions
- Guest (Mode A): random session, 2 h TTL, capacity-bounded, rate-limited per IP; simulated ledger only.
- Watch-only (Mode B): read-only; agent addresses are rejected (`userRole`).
- Wallet (Mode C): SIWE-style message, 5 min TTL, single use, domain bound to the request `Origin`, signature verified with viem.
- Agent (Mode D): STRIKE-generated agent key, AES-256-GCM encrypted with a 32-byte KEK from env (AAD = user id), approved by the user's wallet on testnet. STRIKE never requests seed phrases or master keys.
- Session tokens are stored hashed. Devices pair with single-use 6-digit codes (5 min) and can be revoked (revocation kills the device session immediately). Device sessions cannot mint new pairings.

## Web
- Helmet headers, strict CORS allow-list, zod validation on every body/param, structured errors with redaction, per-IP rate limits (guest creation, pairing, voice), body size limits.
- Third-party text (CoinGecko) is sanitised and displayed as data; user commands are only control-character stripped.

## Secrets
- `.env*`, `secrets/`, `*.key`, `*.pem` are git-ignored; CI includes a 64-hex secret scan. The only key-like value in the repo is the publicly-known python-SDK test key used for signing vectors.
