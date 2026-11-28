export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() }
export function fixedClock(t: number): Clock & { set(t: number): void; advance(ms: number): void } {
  let cur = t
  return { now: () => cur, set: (v) => { cur = v }, advance: (ms) => { cur += ms } }
}
export function ageMs(ts: number, clock: Clock = systemClock): number { return clock.now() - ts }
