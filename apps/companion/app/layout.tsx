import type { Metadata } from 'next'
import { Instrument_Serif, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Shell } from '@/components/ui'

const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif' })
const sans = Inter_Tight({ subsets: ['latin'], variable: '--font-sans-var' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-var' })

export const metadata: Metadata = { title: 'STRIKE G2 — Hyperliquid instruments for Even G2', description: 'Market Radar, Market DNA, Liquidity Lens, Position Orbit and Shadow Trade on Even Realities G2 glasses.' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body><Shell>{children}</Shell></body>
    </html>
  )
}
