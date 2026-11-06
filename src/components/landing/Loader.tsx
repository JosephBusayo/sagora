"use client"

import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { EASE_IN_OUT, EASE_OUT } from './motion'

/** Assets that must be ready before the hero can reveal cleanly. */
const CRITICAL_IMAGES = ['/img/hero-tl.webp', '/img/hero-tr.webp', '/img/hero-bl.webp', '/img/hero-br.webp']

const MIN_MS = 1100 // never faster than this, so the counter reads as progress, not a flicker
const MAX_MS = 4500 // never block the visitor longer than this

function preload(src: string) {
  return new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = src
    if (img.complete) resolve()
  })
}

/**
 * The counter tracks real readiness: fonts + the four hero photographs.
 * Displayed progress eases toward the true value and is also rate-limited
 * by elapsed time, so it climbs smoothly instead of jumping.
 */
export function Loader({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const target = useRef(0)

  useEffect(() => {
    const tasks: Promise<void>[] = [
      ...CRITICAL_IMAGES.map(preload),
      (document.fonts?.ready ?? Promise.resolve()).then(() => undefined),
    ]
    let done = 0
    tasks.forEach((t) => {
      void t.then(() => {
        done += 1
        target.current = done / tasks.length
      })
    })
    const bail = window.setTimeout(() => (target.current = 1), MAX_MS)

    const start = performance.now()
    let value = 0
    let raf = 0
    const tick = (now: number) => {
      const elapsed = now - start
      const timeCap = Math.min(1, elapsed / MIN_MS)
      const goal = Math.min(target.current, timeCap)
      value += (goal - value) * 0.12
      if (goal === 1 && 1 - value < 0.004) value = 1
      setShown(value)
      if (value < 1) raf = requestAnimationFrame(tick)
      else window.setTimeout(() => setLeaving(true), 160)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(bail)
    }
  }, [])

  const pct = Math.round(shown * 100)

  return (
    <motion.div
      className="loader"
      role="progressbar"
      aria-label="Loading Sagora"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      initial={false}
      animate={leaving ? { clipPath: 'inset(0 0 100% 0)' } : { clipPath: 'inset(0 0 0% 0)' }}
      transition={{ duration: 0.8, ease: EASE_IN_OUT }}
      onAnimationComplete={() => leaving && onDone()}
    >
      <motion.div
        className="loader__brand"
        initial={{ opacity: 0, y: 10 }}
        animate={leaving ? { opacity: 0, y: -24 } : { opacity: 1, y: 0 }}
        transition={{ duration: leaving ? 0.45 : 0.6, ease: EASE_OUT }}
      >
        <img src="/img/logo-nav.svg" alt="" width={120} height={36} />
      </motion.div>

      <motion.div
        className="loader__meta"
        animate={leaving ? { opacity: 0 } : { opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <span className="loader__count">
          {pct}
          <span>%</span>
        </span>
        <span className="loader__caption">Agricultural services in Sierra Leone</span>
      </motion.div>

      <div className="loader__track" aria-hidden="true">
        <div className="loader__fill" style={{ transform: `scaleX(${shown})` }} />
      </div>
    </motion.div>
  )
}
