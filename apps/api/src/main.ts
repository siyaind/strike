import { buildApp } from './app'
const { app, config } = await buildApp()
await app.listen({ port: config.port, host: config.host })
console.log(`STRIKE API on :${config.port} (origin ${config.publicOrigin})`)
