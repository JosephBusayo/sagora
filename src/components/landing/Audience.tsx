"use client"

import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AUDIENCES, LINKS, type AudienceKey } from './content'
import { EASE_OUT, settle } from './motion'
import { ButtonLink } from './Button'
import { Reveal, RevealItem } from './Reveal'

const KEYS: AudienceKey[] = ['farmers', 'providers']

/** Each photo's crop box inside its card, as set in the design. */
const SLOT_BOX = [
  { left: '-1.06%', top: '-10.13%', width: '105.2%', height: '109.4%' },
  { left: '0.08%', top: '0%', width: '100%', height: '141.6%' },
  { left: '-2.27%', top: '-11.06%', width: '104.9%', height: '127.7%' },
] as const

/** Max text width from the design, scaled, with a readable floor. */
const fig = (px: number) => ({ maxWidth: `max(300px, calc(var(--u) * ${px}))` })

type Props = {
  active: AudienceKey
  onChange: (key: AudienceKey) => void
}

/**
 * Both audiences are rendered into the same grid cell and crossfaded, so the
 * section is always sized to the taller variant and never jumps on switch.
 */
function Swap({ on, children, delay = 0, className = '' }: { on: boolean; children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={`swap__layer ${className}`}
      aria-hidden={!on}
      inert={!on}
      initial={false}
      animate={on ? { opacity: [0, 1], y: [14, 0] } : { opacity: 0, y: -10 }}
      transition={
        on
          ? { duration: 0.5, ease: EASE_OUT, delay: 0.12 + delay }
          : { duration: 0.22, ease: 'easeIn', delay: delay * 0.5 }
      }
      style={{ pointerEvents: on ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  )
}

export function Audience({ active, onChange }: Props) {
  const tabRefs = useRef<Record<AudienceKey, HTMLButtonElement | null>>({ farmers: null, providers: null })

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = KEYS.indexOf(active)
    let next: AudienceKey | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = KEYS[(i + 1) % KEYS.length]
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = KEYS[(i - 1 + KEYS.length) % KEYS.length]
    if (e.key === 'Home') next = KEYS[0]
    if (e.key === 'End') next = KEYS[KEYS.length - 1]
    if (next) {
      e.preventDefault()
      onChange(next)
      tabRefs.current[next]?.focus()
    }
  }

  return (
    <section className="audience" id="audience" aria-label="Sagora for farmers and service providers">
      <Reveal stagger={0.1} className="audience__head">
        <RevealItem>
          <div className="tabs" role="tablist" aria-label="Choose your audience">
            {KEYS.map((k) => {
              const selected = k === active
              return (
                <button
                  key={k}
                  ref={(el) => {
                    tabRefs.current[k] = el
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${k}`}
                  aria-selected={selected}
                  aria-controls="audience-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`tab ${selected ? 'is-active' : ''}`}
                  onClick={() => onChange(k)}
                  onKeyDown={onKeyDown}
                >
                  {selected && (
                    <motion.span
                      layoutId="tab-indicator"
                      className="tab__indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
                    />
                  )}
                  <span className="tab__label">{AUDIENCES[k].tab}</span>
                </button>
              )
            })}
          </div>
        </RevealItem>
      </Reveal>

      <div id="audience-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
        <Reveal delay={0.08} className="swap audience__copy">
          {KEYS.map((k) => {
            const a = AUDIENCES[k]
            return (
              <Swap key={k} on={k === active}>
                <h2 className="display" style={fig(a.widths.heading)}>
                  {a.heading}
                </h2>
                <p className="lede" style={fig(a.widths.body)}>
                  {a.body}
                </p>
                <ButtonLink size="lg" href={k === 'farmers' ? LINKS.findService : LINKS.joinProvider}>
                  {a.cta}
                </ButtonLink>
              </Swap>
            )
          })}
        </Reveal>

        <Reveal stagger={0.1} className="gallery" amount={0.2}>
          {[0, 1, 2].map((slot) => (
            <RevealItem key={slot} className={`gallery__slot gallery__slot--${slot}`} variants={settle} duration={0.9}>
              <div className="photo photo--tilt">
                {KEYS.map((k) => {
                  const p = AUDIENCES[k].photos[slot]
                  const on = k === active
                  return (
                    <motion.img
                      key={k}
                      src={p.src}
                      alt={on ? p.alt : ''}
                      aria-hidden={!on}
                      className="photo__img"
                      style={{ ...SLOT_BOX[slot], objectFit: p.fit, objectPosition: p.position }}
                      loading="lazy"
                      decoding="async"
                      initial={false}
                      animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.06 }}
                      transition={{ duration: on ? 0.7 : 0.45, ease: EASE_OUT, delay: on ? slot * 0.07 : 0 }}
                    />
                  )
                })}
              </div>
            </RevealItem>
          ))}
        </Reveal>

        <Stats active={active} />
      </div>
    </section>
  )
}

function Stats({ active }: { active: AudienceKey }) {
  return (
    <div className="stats" id="about">
      <Reveal stagger={0.1} amount={0.3} className="stats__inner">
        <RevealItem as="p" className="pill pill--sm">
          <img src="/img/dot.svg" alt="" width={12} height={12} />
          The people around the harvest
        </RevealItem>
        <RevealItem className="swap">
          {KEYS.map((k) => {
            const s = AUDIENCES[k].stat
            return (
              <Swap key={k} on={k === active} className="stats__layer">
                <h2 className="stat" style={fig(s.widths.heading)}>
                  <StatNumber value={s.value} decimals={s.decimals} />
                  {s.rest}
                </h2>
                <p className="lede stats__body" style={fig(s.widths.body)}>
                  {s.body}
                </p>
              </Swap>
            )
          })}
        </RevealItem>
      </Reveal>
    </div>
  )
}

/**
 * Counts up once, the first time the statistic is seen, and always lands on
 * the exact approved value. The final value reserves the layout width so the
 * line never reflows while counting.
 */
function StatNumber({ value, decimals }: { value: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.8 })
  const reduced = useReducedMotion()
  const [count, setCount] = useState(0)
  const shown = reduced ? value : count
  const final = `${value.toFixed(decimals)}%`

  useEffect(() => {
    if (!inView || reduced) return
    const controls = animate(0, value, {
      duration: 1.4,
      ease: EASE_OUT,
      delay: 0.25,
      onUpdate: setCount,
    })
    return () => controls.stop()
  }, [inView, reduced, value])

  return (
    <span className="stat__num" ref={ref}>
      <span className="stat__ghost" aria-hidden="true">
        {final}
      </span>
      <span className="stat__live" aria-hidden="true">
        {shown.toFixed(decimals)}%
      </span>
      <span className="sr-only">{final}</span>
    </span>
  )
}
