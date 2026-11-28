# Hyperliquid testnet verification

Command: `pnpm testnet:probe` (`apps/api/scripts/testnet-probe.ts`). Evidence: `evidence/testnet/probe.json`.

## Key loading (runtime only)
`@strike/signer/testnet-key` → `loadTestnetAccount()`: `STRIKE_TESTNET_PRIVATE_KEY` (env) or `STRIKE_TESTNET_KEY_FILE` (mode 600; raw hex or JSON `{ "privateKey": "0x…" }`), defaulting to `/home/box/secrets/strike-testnet-wallet.json` then `/home/box/secrets/strike-testnet.key`. Never printed, never committed; refused if group/world-readable. Unit-tested (`packages/signer/src/testnet-key.test.ts`).

**Dedicated wallet (28 Nov 2026):** `0x5C2032945E13dA8B0B72031Dd2824Daa073a23Be` — key file present on the build box (mode 600); loader verified to resolve exactly this address. **Not yet funded / no mainnet deposit confirmed**, so the faucet cannot be claimed and no testnet order has been placed with it. Next step once the owner confirms the mainnet deposit: claim the testnet faucet for this address, then run `pnpm testnet:probe` (places a tiny far-from-market GTC and cancels it) and record the real response here.

## Earlier probe (first, throwaway key)

### Result (25 Nov 2026, 11:40 IST / 06:10 UTC)

| Step | Outcome |
|---|---|
| Testnet `clearinghouseState` for the new address | accountValue 0.0 |
| Testnet `userRole` | `missing` (never funded) |
| Mainnet `clearinghouseState` (read-only) | 0.0 → **testnet faucet unavailable** (requires a prior mainnet deposit from the same address) |
| Construct exchange client with `env: 'mainnet'` | **Blocked**: `Mainnet signed execution is disabled in STRIKE` |
| Signed testnet order (BTC GTC, 50 % below mid, ~$12, asset id 3 resolved live from testnet meta) | HTTP 200, `{"status":"err","response":"User or API Wallet 0xebc6…c31b does not exist."}` |

What this proves: the testnet **accepted and verified our signature** — the address it recovered from the L1 signature is exactly our signer address. What it does not prove: order placement, fills, protective orders, or reconciliation against a funded account.

**Status: testnet trading BLOCKED (unfunded).** Owner action: fund the testnet address via the faucet (needs a mainnet deposit from the same address) or provide a funded testnet *agent* approval. No order ids are claimed anywhere in this repo.
