import { Frame, validateImageSize, G2_IMG_MAX_W } from './framebuffer'
import { encodePng } from './png'

export interface ImageSlot { containerID: number; containerName: string; x: number; y: number; w: number; h: number }
export interface RenderMetrics { renders: number; transfers: number; suppressed: number; failures: number; lastTransferMs: number | null; avgTransferMs: number | null; lastError: string | null }
export type ImageSender = (slot: ImageSlot, png: Uint8Array) => Promise<'success' | string>

/** Split a wide instrument (≤576×144) into ≤288-wide tiles that satisfy SDK image-container limits. */
export function tile(frame: Frame, slots: ImageSlot[]): Array<{ slot: ImageSlot; frame: Frame }> {
  let x = 0
  return slots.map((slot) => {
    const err = validateImageSize(slot.w, slot.h)
    if (err) throw new Error(`Container ${slot.containerName}: ${err}`)
    const t = frame.crop(x, 0, Math.min(slot.w, G2_IMG_MAX_W), slot.h)
    x += slot.w
    return { slot, frame: t }
  })
}

/** Serial image queue: SDK requires updateImageRawData calls to be awaited one at a time.
 * - Duplicate suppression by per-slot content hash.
 * - Latest-wins coalescing: if a newer frame for the same slot is queued, the stale one is dropped.
 * - Failures are reported, never retried silently; callers keep navigation/cancel working regardless. */
export class ImageQueue {
  private lastHash = new Map<number, string>()
  private pending = new Map<number, { png: Uint8Array; hash: string; slot: ImageSlot }>()
  private running: Promise<void> = Promise.resolve()
  readonly metrics: RenderMetrics = { renders: 0, transfers: 0, suppressed: 0, failures: 0, lastTransferMs: null, avgTransferMs: null, lastError: null }
  private totalMs = 0
  constructor(private readonly send: ImageSender, private readonly now: () => number = () => performance.now()) {}

  submit(slot: ImageSlot, frame: Frame): Promise<void> {
    this.metrics.renders++
    const h = frame.hash()
    if (this.lastHash.get(slot.containerID) === h && !this.pending.has(slot.containerID)) { this.metrics.suppressed++; return this.running }
    if (this.pending.has(slot.containerID)) this.metrics.suppressed++
    this.pending.set(slot.containerID, { png: encodePng(frame), hash: h, slot })
    this.running = this.running.then(() => this.drain(slot.containerID))
    return this.running
  }
  private async drain(id: number) {
    const job = this.pending.get(id)
    if (!job) return
    this.pending.delete(id)
    const t0 = this.now()
    try {
      const r = await this.send(job.slot, job.png)
      const dt = this.now() - t0
      this.metrics.lastTransferMs = dt; this.totalMs += dt
      if (r === 'success') { this.metrics.transfers++; this.lastHash.set(id, job.hash); this.metrics.avgTransferMs = this.totalMs / this.metrics.transfers }
      else { this.metrics.failures++; this.metrics.lastError = String(r); this.lastHash.delete(id) }
    } catch (e) {
      this.metrics.failures++; this.metrics.lastError = String((e as Error)?.message ?? e); this.lastHash.delete(id)
    }
  }
  invalidate() { this.lastHash.clear() }
  idle() { return this.running }
}
