import type { Transition, Variants } from 'motion/react'

// One easing family across the page: a soft "expo-out" for entrances and a
// gentler in-out for state changes.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const

export const DUR = {
  micro: 0.2,
  control: 0.26,
  reveal: 0.7,
  section: 0.85,
} as const

export const STAGGER = 0.09

export const reveal = (delay = 0, duration: number = DUR.reveal): Transition => ({
  duration,
  delay,
  ease: EASE_OUT,
})

/** Fade + small rise — the default for headings and copy. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0 },
}

/** Images: a touch of scale so photographs settle into place. */
export const settle: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1 },
}

/**
 * Shared viewport config. No negative bottom margin: content at the very end
 * of the page must still be able to cross the threshold and reveal.
 */
export const VIEWPORT = { once: true, amount: 0.2 } as const
