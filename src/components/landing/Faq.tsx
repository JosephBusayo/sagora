"use client"

import { AnimatePresence, motion } from 'motion/react'
import { useId, useState } from 'react'
import { FAQS } from './content'
import { EASE_IN_OUT, EASE_OUT } from './motion'
import { Reveal, RevealItem } from './Reveal'

/**
 * One answer open at a time, matching the design (which shows a single open
 * item). Clicking the open question closes it.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(1)
  const base = useId()

  return (
    <section className="faq" id="faq" aria-labelledby="faq-title">
      <img className="faq__shape" src="/img/faq-shape.svg" alt="" aria-hidden="true" width={2813} height={752} />
      <div className="faq__inner">
        <Reveal stagger={0.08} className="faq__intro">
          <RevealItem as="p" className="faq__eyebrow">
            FAQ
          </RevealItem>
          <RevealItem as="h2" className="faq__title" id="faq-title">
            Frequently asked questions
          </RevealItem>
          <RevealItem as="p" className="faq__sub">
            A few things you might want to know.
          </RevealItem>
        </Reveal>

        <Reveal as="ul" stagger={0.07} delay={0.1} className="faq__list" amount={0.15}>
          {FAQS.map((f, i) => {
            const isOpen = open === i
            const btnId = `${base}-q${i}`
            const panelId = `${base}-a${i}`
            return (
              <RevealItem as="li" key={f.q} className={`faq__item ${isOpen ? 'is-open' : ''}`}>
                <h3 className="faq__q">
                  <button
                    type="button"
                    id={btnId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    <span>{f.q}</span>
                    <span className="faq__icon" aria-hidden="true">
                      <img src="/img/faq-chevron.svg" alt="" width={24} height={24} />
                    </span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={panelId}
                      role="region"
                      aria-labelledby={btnId}
                      className="faq__a"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{
                        height: 'auto',
                        opacity: 1,
                        transition: { height: { duration: 0.42, ease: EASE_IN_OUT }, opacity: { duration: 0.3, delay: 0.1 } },
                      }}
                      exit={{
                        height: 0,
                        opacity: 0,
                        transition: { height: { duration: 0.34, ease: EASE_IN_OUT }, opacity: { duration: 0.16 } },
                      }}
                    >
                      <motion.div
                        initial={{ y: -6 }}
                        animate={{ y: 0 }}
                        exit={{ y: -4 }}
                        transition={{ duration: 0.4, ease: EASE_OUT }}
                        className="faq__a-inner"
                      >
                        <p>{f.answer}</p>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </RevealItem>
            )
          })}
        </Reveal>
      </div>
    </section>
  )
}
