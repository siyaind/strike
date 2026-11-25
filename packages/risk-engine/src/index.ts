export interface RiskPolicy {
  maxOrderNotionalUsd: number
  maxLeverage: number
  maxPositionExposureUsd: number
  maxTotalExposureUsd: number
  maxConcentrationPct: number
  maxMarginUtilizationPct: number
  minAvailableCollateralUsd: number
  maxSlippageBps: number
  allowedAssets: string[] | null
  blockedAssets: string[]
  maxOpenOrders: number
  sessionBudgetUsd: number
  riskBudgetUsd: number // margin the user is willing to commit; drives "risk budget usage"
}
export const DEFAULT_POLICY: RiskPolicy = {
  maxOrderNotionalUsd: 1000, maxLeverage: 5, maxPositionExposureUsd: 2500, maxTotalExposureUsd: 5000, maxConcentrationPct: 60,
  maxMarginUtilizationPct: 50, minAvailableCollateralUsd: 50, maxSlippageBps: 50, allowedAssets: null, blockedAssets: [], maxOpenOrders: 20,
  sessionBudgetUsd: 3000, riskBudgetUsd: 500,
}

export interface RiskInput {
  coin: string; reduceOnly: boolean
  orderNotionalUsd: number; leverage: number; assetMaxLeverage: number
  positionExposureAfterUsd: number; totalExposureAfterUsd: number
  accountValueUsd: number | null; marginUsedAfterUsd: number | null; availableCollateralUsd: number | null
  estSlippageBps: number | null; openOrders: number; sessionNotionalUsedUsd: number
  dataTs: number; now: number; maxDataAgeMs: number
}
export type RiskStatus = 'pass' | 'fail' | 'unknown'
export interface RiskCheck { rule: string; status: RiskStatus; value: string; limit: string; detail: string }
export interface RiskResult { ok: boolean; checks: RiskCheck[]; assumptions: string[] }

/** Deterministic, server-side. Unknown inputs FAIL CLOSED for opening orders; reduce-only orders skip exposure-increasing limits. */
export function evaluateRisk(i: RiskInput, p: RiskPolicy = DEFAULT_POLICY): RiskResult {
  const c: RiskCheck[] = []
  const add = (rule: string, status: RiskStatus, value: string, limit: string, detail: string) => c.push({ rule, status, value, limit, detail })
  const usd = (n: number) => `$${n.toFixed(2)}`
  const C = i.coin.toUpperCase()
  add('data-freshness', i.now - i.dataTs <= i.maxDataAgeMs ? 'pass' : 'fail', `${Math.round((i.now - i.dataTs) / 1000)}s`, `${Math.round(i.maxDataAgeMs / 1000)}s`, 'Execution checks require a fresh snapshot')
  add('asset-allowed', p.blockedAssets.map((a) => a.toUpperCase()).includes(C) || (p.allowedAssets && !p.allowedAssets.map((a) => a.toUpperCase()).includes(C)) ? 'fail' : 'pass', C, p.allowedAssets ? p.allowedAssets.join(',') : 'any', 'Allowed/blocked asset lists')
  add('max-order-notional', i.orderNotionalUsd <= p.maxOrderNotionalUsd ? 'pass' : 'fail', usd(i.orderNotionalUsd), usd(p.maxOrderNotionalUsd), 'Per-order notional cap')
  add('open-orders', i.openOrders < p.maxOpenOrders ? 'pass' : 'fail', String(i.openOrders), String(p.maxOpenOrders), 'Open order count')
  add('slippage', i.estSlippageBps == null ? 'unknown' : i.estSlippageBps <= p.maxSlippageBps ? 'pass' : 'fail', i.estSlippageBps == null ? 'unavailable' : `${i.estSlippageBps.toFixed(1)}bp`, `${p.maxSlippageBps}bp`, 'Estimated from visible L2 depth')
  if (!i.reduceOnly) {
    add('max-leverage', i.leverage <= Math.min(p.maxLeverage, i.assetMaxLeverage) ? 'pass' : 'fail', `${i.leverage}x`, `${Math.min(p.maxLeverage, i.assetMaxLeverage)}x`, `Policy ${p.maxLeverage}x, exchange max ${i.assetMaxLeverage}x`)
    add('position-exposure', i.positionExposureAfterUsd <= p.maxPositionExposureUsd ? 'pass' : 'fail', usd(i.positionExposureAfterUsd), usd(p.maxPositionExposureUsd), 'Exposure in this market after the order')
    add('total-exposure', i.totalExposureAfterUsd <= p.maxTotalExposureUsd ? 'pass' : 'fail', usd(i.totalExposureAfterUsd), usd(p.maxTotalExposureUsd), 'Gross exposure after the order')
    const conc = i.totalExposureAfterUsd > 0 ? (i.positionExposureAfterUsd / i.totalExposureAfterUsd) * 100 : 0
    add('concentration', i.totalExposureAfterUsd < 100 || conc <= p.maxConcentrationPct ? 'pass' : 'fail', `${conc.toFixed(0)}%`, `${p.maxConcentrationPct}%`, 'Share of gross exposure in one asset (ignored below $100 gross)')
    if (i.accountValueUsd == null || i.marginUsedAfterUsd == null) add('margin-utilization', 'unknown', 'unavailable', `${p.maxMarginUtilizationPct}%`, 'Account value unavailable')
    else { const u = i.accountValueUsd > 0 ? (i.marginUsedAfterUsd / i.accountValueUsd) * 100 : Infinity; add('margin-utilization', u <= p.maxMarginUtilizationPct ? 'pass' : 'fail', `${Number.isFinite(u) ? u.toFixed(0) : '∞'}%`, `${p.maxMarginUtilizationPct}%`, 'Initial margin used / account value after the order') }
    add('min-collateral', i.availableCollateralUsd == null ? 'unknown' : i.availableCollateralUsd >= p.minAvailableCollateralUsd ? 'pass' : 'fail', i.availableCollateralUsd == null ? 'unavailable' : usd(i.availableCollateralUsd), usd(p.minAvailableCollateralUsd), 'Collateral remaining after margin')
    add('session-budget', i.sessionNotionalUsedUsd + i.orderNotionalUsd <= p.sessionBudgetUsd ? 'pass' : 'fail', usd(i.sessionNotionalUsedUsd + i.orderNotionalUsd), usd(p.sessionBudgetUsd), 'Cumulative opened notional this session')
  }
  return { ok: c.every((x) => x.status === 'pass'), checks: c, assumptions: ['Margin = notional ÷ leverage (initial margin estimate; exchange maintenance tiers not modelled)', 'Slippage from visible book only; actual fills may differ', 'Unknown inputs fail closed'] }
}
