import { expect, test, type Page } from '@playwright/test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * Companion wallet connection with a MOCKED injected EIP-1193 provider. The "wallet" is a throwaway key generated
 * in this test process (never funded, never stored). Signing happens in Node via exposeFunction; the page only sees
 * window.ethereum.request(). Any transaction-sending method is refused and recorded so we can assert none occurred.
 */
const shots = process.env.E2E_SHOTS ?? 'evidence/e2e/screens'

async function injectWallet(page: Page) {
  const account = privateKeyToAccount(generatePrivateKey())
  const calls: Array<{ method: string; params?: unknown }> = []
  await page.exposeFunction('__strikeMockWallet', async (method: string, params: any[]) => {
    calls.push({ method, params })
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [account.address]
      case 'eth_chainId': return '0x66eee' // Arbitrum Sepolia (Hyperliquid testnet signature chain)
      case 'personal_sign': return account.signMessage({ message: params[0] as string })
      case 'eth_signTypedData_v4': {
        const td = JSON.parse(params[1] as string); const { EIP712Domain: _drop, ...types } = td.types
        return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
      }
      default: throw new Error(`mock wallet refuses ${method}`)
    }
  })
  await page.addInitScript(() => {
    const w = window as any
    w.ethereum = { isMockStrikeWallet: true, request: ({ method, params }: { method: string; params?: unknown[] }) => w.__strikeMockWallet(method, params ?? []) }
  })
  return { account, calls }
}

test('wallet: connect via injected EIP-1193 provider → personal_sign ownership proof → wallet mode (no transactions)', async ({ page }) => {
  const { account, calls } = await injectWallet(page)
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByText('mode: wallet')).toBeVisible()
  await expect(page.getByText(`${account.address.toLowerCase().slice(0, 6)}…${account.address.toLowerCase().slice(-4)}`)).toBeVisible()
  await expect(page.getByText('testnet', { exact: true }).first()).toBeVisible()
  const methods = calls.map((c) => c.method)
  expect(methods).toEqual(['eth_requestAccounts', 'personal_sign'])
  const msg = String((calls[1]!.params as string[])[0])
  expect(msg).toMatch(/STRIKE/i); expect(msg).not.toMatch(/seed|private key/i)
  expect(methods.some((m) => /sendTransaction|sendRawTransaction|eth_sign$/.test(m))).toBe(false)
  await page.screenshot({ path: `${shots}/wallet-connected.png`, fullPage: true })
  // sign out revokes the session
  await page.getByRole('button', { name: 'Sign out everywhere' }).click()
  await expect(page.getByText('mode: wallet')).toHaveCount(0)
})

test('wallet: rejected signature leaves the user signed out with a readable error', async ({ page }) => {
  await page.addInitScript(() => { (window as any).ethereum = { request: async ({ method }: { method: string }) => { if (method === 'eth_requestAccounts') return ['0x000000000000000000000000000000000000dEaD']; const e: any = new Error('User rejected the request.'); e.code = 4001; throw e } } })
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByText(/User rejected the request/)).toBeVisible()
  await expect(page.getByText('mode: wallet')).toHaveCount(0)
})

test('wallet: Mode D agent approval is EIP-712 for Hyperliquid TESTNET only', async ({ page, baseURL }) => {
  test.skip(!!baseURL && !baseURL.includes('localhost'), 'Public deploy has no signer keystore by design (Mode D disabled)')
  const { calls } = await injectWallet(page)
  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByText('mode: wallet')).toBeVisible()
  await page.getByRole('button', { name: /Create .* approve agent/ }).click()
  await expect(page.getByText(/^agent 0x[0-9a-fA-F]{40}$/)).toBeVisible()
  const td = calls.find((c) => c.method === 'eth_signTypedData_v4')
  expect(td).toBeTruthy()
  const data = JSON.parse((td!.params as string[])[1]!)
  expect(data.message.hyperliquidChain).toBe('Testnet')
  expect(data.primaryType).toMatch(/ApproveAgent/)
  expect(calls.map((c) => c.method).some((m) => /sendTransaction/.test(m))).toBe(false)
  await page.screenshot({ path: `${shots}/wallet-agent-testnet.png`, fullPage: true })
})
