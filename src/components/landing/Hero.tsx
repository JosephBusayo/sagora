"use client"

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { Fragment, useEffect, useState } from 'react'
import { EASE_OUT } from './motion'
import { ButtonLink } from './Button'
import { LINKS } from './content'

/**
 * Geometry is taken from the 1728px Figma frame: `x`/`y` place the card,
 * the `img` style reproduces each photo's crop inside its 389×235 card.
 */
const PHOTOS = [
  {
    id: 'tl',
    src: '/img/hero-tl.webp',
    alt: 'A tractor working a green field',
    x: -151,
    y: 184,
    from: { x: 60, y: 30 },
    delay: 0.42,
    depth: 1,
    img: { width: '163.5%', height: '481.7%', left: '50%', top: '81.7%', transform: 'translate(-50%, -50%)' },
  },
  {
    id: 'tr',
    src: '/img/hero-tr.webp',
    alt: 'A smiling farmer holding a basket of fresh vegetables',
    x: 1445,
    y: 184,
    from: { x: -60, y: 30 },
    delay: 0.52,
    depth: 1,
    img: { width: '106.2%', height: '117%', left: 0, top: 0 },
  },
  {
    id: 'bl',
    src: '/img/hero-bl.webp',
    alt: 'A farmer tending tall crops',
    x: 36,
    y: 512,
    from: { x: 50, y: 40 },
    delay: 0.62,
    depth: 0.6,
    img: { width: '99.7%', height: '180.4%', left: '0.3%', top: '-29.4%' },
  },
  {
    id: 'br',
    src: '/img/hero-br.webp',
    alt: 'A crate of freshly harvested vegetables',
    x: 1303,
    y: 512,
    from: { x: -50, y: 40 },
    delay: 0.72,
    depth: 0.6,
    img: { width: '104.6%', height: '260%', left: '50%', top: '60.2%', transform: 'translate(-50%, -50%)' },
  },
] as const

const HEADLINE = ['Everything it takes to', 'get farm work done']

export function Hero({ intro }: { intro: boolean }) {
  const reduced = useReducedMotion()
  const { scrollY } = useScroll()
  const [finePointer, setFinePointer] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1100px)')
    const update = () => setFinePointer(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const parallax = finePointer && !reduced
  const state = intro ? 'show' : 'hidden'
  let wordIndex = 0

  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero__content">
        <motion.p
          className="pill"
          initial="hidden"
          animate={state}
          variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
        >
          <img src="/img/dot.svg" alt="" width={12} height={12} />
          Agricultural services in Sierra Leone
        </motion.p>

        <h1 id="hero-title" className="hero__title">
          {HEADLINE.map((line) => (
            <span className="hero__line" key={line}>
              {line.split(' ').map((word) => {
                const i = wordIndex++
                return (
                  <Fragment key={word + i}>
                    <span className="word">
                      <motion.span
                        className="word__inner"
                        initial="hidden"
                        animate={state}
                        variants={{ hidden: { y: '108%', opacity: 0 }, show: { y: '0%', opacity: 1 } }}
                        transition={{ duration: 0.85, ease: EASE_OUT, delay: 0.22 + i * 0.065 }}
                      >
                        {word}
                      </motion.span>
                    </span>{' '}
                  </Fragment>
                )
              })}
            </span>
          ))}
        </h1>

        <motion.p
          className="hero__lede"
          initial="hidden"
          animate={state}
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.82 }}
        >
          Sagora connects farmers with agricultural service providers for ploughing, planting and harvesting, while giving
          providers the tools to manage their equipment, jobs and payments.
        </motion.p>

        <motion.div
          initial="hidden"
          animate={state}
          variants={{ hidden: { opacity: 0, y: 14, scale: 0.97 }, show: { opacity: 1, y: 0, scale: 1 } }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.98 }}
        >
          <ButtonLink className="btn--cta" href={LINKS.farmerSignIn}>
            Find a service provider
            <img className="btn__icon" src="/img/arrow-up-right.svg" alt="" width={24} height={24} />
          </ButtonLink>
          <ButtonLink variant="secondary" className="btn--cta" href={LINKS.findService}>
            Make a quick request
          </ButtonLink>
          <p className="hero__find">
            Already sent a request? <a href={LINKS.findRequest}>Find it here</a>
          </p>
        </motion.div>
      </div>

      {/* The outer photos run off the screen edge on purpose, as in the design. */}
      <div className="hero__photos" data-bleeds>
        {PHOTOS.map((p) => (
          <ParallaxLayer key={p.id} id={p.id} x={p.x} y={p.y} depth={p.depth} scrollY={scrollY} enabled={parallax}>
            <motion.div
              className="hero__photo-in"
              initial="hidden"
              animate={state}
              variants={{
                hidden: { opacity: 0, x: p.from.x, y: p.from.y, scale: 0.9 },
                show: { opacity: 1, x: 0, y: 0, scale: 1 },
              }}
              transition={{ duration: 1.1, ease: EASE_OUT, delay: p.delay }}
            >
              <div className="photo">
                <img
                  src={p.src}
                  alt={p.alt}
                  className="photo__img"
                  style={p.img}
                  fetchPriority={p.id === 'tl' || p.id === 'tr' ? 'high' : 'auto'}
                  decoding="async"
                />
              </div>
            </motion.div>
          </ParallaxLayer>
        ))}
      </div>
    </section>
  )
}

function ParallaxLayer({
  id,
  x,
  y,
  depth,
  scrollY,
  enabled,
  children,
}: {
  id: string
  x: number
  y: number
  depth: number
  scrollY: MotionValue<number>
  enabled: boolean
  children: React.ReactNode
}) {
  // A very small drift: at most ~28px over the first 700px of scroll.
  const drift = useTransform(scrollY, [0, 700], [0, -28 * depth], { clamp: true })
  return (
    <motion.div
      className={`hero__photo hero__photo--${id}`}
      style={{ '--x': x, '--y': y, y: enabled ? drift : 0 } as never}
    >
      {children}
    </motion.div>
  )
}
