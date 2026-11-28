/** Deterministic API for e2e tests: real recorded Hyperliquid/CoinGecko responses, a clock anchored to the recording time. Never used in production. */
import { randomBytes } from 'node:crypto'
import { buildApp } from './app'
import { fakes, T0 } from '../../../tests/fakes'

const start = Date.now()
const now = () => T0 + (Date.now() - start)
const port = Number(process.env.PORT ?? 8898)
const { app } = await buildApp({ ...fakes({ bookTime: now }), now, config: { offline: true, confirmSecret: randomBytes(32).toString('hex'), signerKek: randomBytes(32), allowedOrigins: ['http://localhost:3100', 'http://127.0.0.1:3100'], publicOrigin: 'http://localhost:3100', guestPerMinute: 120 /* e2e: one IP runs every test */ } })
await app.listen({ port, host: '127.0.0.1' })
console.log(`STRIKE fixture API on :${port} (recorded data, clock anchored at ${new Date(T0).toISOString()})`)
