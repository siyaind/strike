import { buildApp } from './app'
const { app, config } = await buildApp()
await app.listen({ port: config.port, host: config.host })
console.log(`STRIKE API on :${config.port} (origin ${config.publicOrigin})`)
// Graceful shutdown (Render sends SIGTERM): flush the optional Postgres write-through, close WS feeds.
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { void app.close().finally(() => process.exit(0)) })
