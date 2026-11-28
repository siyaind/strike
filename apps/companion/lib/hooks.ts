'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ensureSession } from './api'

export function useSession() {
  const [me, setMe] = useState<any>(null); const [err, setErr] = useState<string | null>(null)
  const refresh = useCallback(async () => { try { await ensureSession(); setMe(await api('/v1/me')); setErr(null) } catch (e) { setMe(null); setErr((e as Error).message) } }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { me, err, refresh }
}

/** Polls an endpoint. Keeps the last good value and exposes its age; never invents data on failure. */
export function usePoll<T = any>(path: string | null, ms = 5000, needsSession = false) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null); const [at, setAt] = useState<number | null>(null)
  const alive = useRef(true)
  const load = useCallback(async () => {
    if (!path) return
    try { if (needsSession) await ensureSession(); const d = await api<T>(path); if (alive.current) { setData(d); setErr(null); setAt(Date.now()) } } catch (e) { if (alive.current) setErr((e as Error).message) }
  }, [path, needsSession])
  useEffect(() => { alive.current = true; void load(); const t = setInterval(load, ms); return () => { alive.current = false; clearInterval(t) } }, [load, ms])
  return { data, err, at, reload: load }
}
