# Hyperliquid testnet verification

Command: `pnpm testnet:probe` (`apps/api/scripts/testnet-probe.ts`). Key: generated locally into `/home/box/secrets/strike-testnet.key` (mode 600, outside the repo, never printed). Evidence: `evidence/testnet/probe.json`.

## Result (25 Nov 2026, 11:40 IST / 06:10 UTC)

| Step | Outcome |
|---|---|
| Testnet `clearinghouseState` for the new address | accountValue 0.0 |
| Testnet `userRole` | `missing` (never funded) |
| Mainnet `clearinghouseState` (read-only) | 0.0 → **testnet faucet unavailable** (requires a prior mainnet deposit from the same address) |
| Construct exchange client with `env: 'mainnet'` | **Blocked**: `Mainnet signed execution is disabled in STRIKE` |
| Signed testnet order (BTC GTC, 50 % below mid, ~$12, asset id 3 resolved live from testnet meta) | HTTP 200, `{"status":"err","response":"User or API Wallet 0xebc6…c31b does not exist."}` |

What this proves: the testnet **accepted and verified our signature** — the address it recovered from the L1 signature is exactly our signer address. What it does not prove: order placement, fills, protective orders, or reconciliation against a funded account.

**Status: testnet trading BLOCKED (unfunded).** Owner action: fund the testnet address via the faucet (needs a mainnet deposit from the same address) or provide a funded testnet *agent* approval. No order ids are claimed anywhere in this repo.
