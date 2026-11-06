"use client"

import { motion } from 'motion/react'
import { STEPS } from './content'
import { EASE_OUT, settle } from './motion'
import { Reveal, RevealItem } from './Reveal'

const part = (delay: number, from: { x?: number; y?: number; rotate?: number } = {}) => ({
  hidden: { opacity: 0, x: from.x ?? 0, y: from.y ?? 16, rotate: from.rotate ?? 0 },
  show: {
    opacity: 1,
    x: 0,
    y: 0,
    rotate: 0,
    transition: { duration: 0.8, ease: EASE_OUT, delay },
  },
})

/** Step 1 is three separate layers in the design, so it assembles itself. */
function StepOneArt() {
  return (
    <div className="art art--one" aria-hidden="true">
      <motion.img variants={part(0.15, { y: 22 })} className="art__phone" src="/img/step1-phone.svg" alt="" width={253} height={167} />
      <motion.img variants={part(0.45, { x: -14, y: 18, rotate: -8 })} className="art__envelope" src="/img/step1-envelope.svg" alt="" width={100} height={149} />
      <motion.img variants={part(0.35, { x: -6, y: 6 })} className="art__arrow" src="/img/step1-arrow.svg" alt="" width={37} height={44} />
    </div>
  )
}

const ART = [
  <StepOneArt key="1" />,
  <div className="art art--two" aria-hidden="true" key="2">
    <motion.img variants={part(0.2, { y: 22 })} src="/img/step2-chat.svg" alt="" width={256} height={326} />
  </div>,
  <div className="art art--three" aria-hidden="true" key="3">
    <motion.img variants={part(0.2, { y: 22 })} src="/img/step3-checklist.svg" alt="" width={353} height={279} />
  </div>,
]

export function Process() {
  return (
    <section className="process" id="how-it-works" aria-labelledby="process-title">
      <Reveal className="process__panel" variants={settle} duration={0.9} amount={0.01}>
        <Reveal stagger={0.1} className="process__head">
          <RevealItem as="h2" className="h2" id="process-title">
            The right service for the work ahead
          </RevealItem>
          <RevealItem as="p" className="process__lede">
            A simple and transparent process for farmers, with everything you need to keep your job moving.
          </RevealItem>
        </Reveal>

        <Reveal as="ul" stagger={0.11} delay={0.1} className="steps" amount={0.15}>
          {STEPS.map((s, i) => (
            <RevealItem as="li" key={s.title} className="step">
              <div className="step__art">{ART[i]}</div>
              <div className="step__text">
                <h3 className="step__title">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="step__body">{s.body}</p>
              </div>
            </RevealItem>
          ))}
        </Reveal>
      </Reveal>
    </section>
  )
}
