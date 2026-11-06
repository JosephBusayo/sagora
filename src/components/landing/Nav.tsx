"use client"

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { LINKS } from './content'
import { EASE_OUT } from './motion'
import { Button, ButtonLink } from './Button'

type Props = {
  intro: boolean
  onProviders: () => void
}

export function Nav({ intro, onProviders }: Props) {
  // Which desktop dropdown is open: the provider links, or the choice of sign-in.
  const [dropdown, setDropdown] = useState<'providers' | 'signIn' | null>(null)
  const [menu, setMenu] = useState(false)
  const [mobileSignIn, setMobileSignIn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dropBtn = useRef<HTMLButtonElement>(null)
  const signRef = useRef<HTMLDivElement>(null)
  const signBtn = useRef<HTMLButtonElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!dropdown) return
    const onDown = (e: PointerEvent) => {
      const inside = [dropRef, signRef].some((r) => r.current?.contains(e.target as Node))
      if (!inside) setDropdown(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdown(null)
        ;(dropdown === 'signIn' ? signBtn : dropBtn).current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dropdown])

  // Mobile menu: lock page scroll, close on Escape or when resizing to desktop.
  useEffect(() => {
    if (!menu) return
    document.documentElement.classList.add('is-locked')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(false)
        menuBtn.current?.focus()
      }
    }
    const mq = window.matchMedia('(min-width: 1000px)')
    const onMq = () => mq.matches && setMenu(false)
    document.addEventListener('keydown', onKey)
    mq.addEventListener('change', onMq)
    return () => {
      document.documentElement.classList.remove('is-locked')
      document.removeEventListener('keydown', onKey)
      mq.removeEventListener('change', onMq)
    }
  }, [menu])

  const close = () => {
    setDropdown(null)
    setMenu(false)
    setMobileSignIn(false)
  }

  const providerItems = [
    {
      label: 'Offer your services',
      href: '#audience',
      onClick: () => {
        close()
        onProviders()
      },
    },
    { label: 'Provider workspace', href: LINKS.workspace, onClick: close },
    { label: 'Provider FAQs', href: '#faq', onClick: close },
  ]

  return (
    <motion.header
      className={`nav ${scrolled ? 'nav--scrolled' : ''}`}
      initial={{ opacity: 0, y: -12 }}
      animate={intro ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, ease: EASE_OUT }}
    >
      <div className="nav__inner">
        <a href="#top" className="nav__logo" aria-label="Sagora — back to top" onClick={close}>
          <img src="/brand/logo-wordmark.svg" alt="Sagora" width={108} height={28} />
        </a>

        <nav className="nav__links" aria-label="Main">
          <a className="nav__link" href="#how-it-works">
            How it works
          </a>
          <a className="nav__link" href="#about">
            About Sagora
          </a>
          <div className="nav__drop" ref={dropRef}>
            <button
              ref={dropBtn}
              type="button"
              className="nav__link nav__drop-btn"
              aria-expanded={dropdown === 'providers'}
              aria-controls="provider-menu"
              onClick={() => setDropdown((v) => (v === 'providers' ? null : 'providers'))}
            >
              For service providers
              <img src="/img/chevron.svg" alt="" width={24} height={24} className="nav__chev" />
            </button>
            <AnimatePresence>
              {dropdown === 'providers' && (
                <motion.ul id="provider-menu" className="nav__menu" {...dropMotion}>
                  {providerItems.map((item) => (
                    <li key={item.label}>
                      {item.href ? (
                        <a href={item.href} className="nav__menu-item" onClick={item.onClick}>
                          {item.label}
                        </a>
                      ) : (
                        <button type="button" className="nav__menu-item" onClick={item.onClick}>
                          {item.label}
                        </button>
                      )}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
          <div className="nav__actions">
            <div className="nav__drop" ref={signRef}>
              <Button
                ref={signBtn}
                variant="secondary"
                size="sm"
                aria-expanded={dropdown === 'signIn'}
                aria-controls="sign-in-menu"
                onClick={() => setDropdown((v) => (v === 'signIn' ? null : 'signIn'))}
              >
                Sign in
              </Button>
              <AnimatePresence>
                {dropdown === 'signIn' && (
                  <motion.ul id="sign-in-menu" className="nav__menu nav__menu--end" {...dropMotion}>
                    {signInItems.map((item) => (
                      <li key={item.label}>
                        <a href={item.href} className="nav__menu-item" onClick={close}>
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
            <ButtonLink size="sm" href={LINKS.findService}>
              Try Sagora
            </ButtonLink>
          </div>
        </nav>

        <button
          ref={menuBtn}
          type="button"
          className={`nav__burger ${menu ? 'is-open' : ''}`}
          aria-expanded={menu}
          aria-controls="mobile-menu"
          aria-label={menu ? 'Close menu' : 'Open menu'}
          onClick={() => {
            setMenu((v) => !v)
            setMobileSignIn(false)
          }}
        >
          <span />
          <span />
        </button>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            key="scrim"
            className="mnav-scrim"
            aria-hidden="true"
            onClick={() => setMenu(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        )}
        {menu && (
          <motion.div
            key="menu"
            id="mobile-menu"
            className="mnav"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <motion.nav
              aria-label="Mobile"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.06 } } }}
            >
              {[
                { label: 'How it works', href: '#how-it-works', onClick: close },
                { label: 'About Sagora', href: '#about', onClick: close },
              ].map((l) => (
                <motion.a key={l.label} href={l.href} onClick={l.onClick} className="mnav__link" variants={item}>
                  {l.label}
                </motion.a>
              ))}
              <motion.p className="mnav__label" variants={item}>
                For service providers
              </motion.p>
              {providerItems.map((p) =>
                p.href ? (
                  <motion.a key={p.label} href={p.href} onClick={p.onClick} className="mnav__sub" variants={item}>
                    {p.label}
                  </motion.a>
                ) : (
                  <motion.button key={p.label} type="button" onClick={p.onClick} className="mnav__sub" variants={item}>
                    {p.label}
                  </motion.button>
                ),
              )}
              {mobileSignIn && (
                <motion.div id="mobile-sign-in" className="mnav__choice" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
                  <motion.p className="mnav__label" variants={item}>
                    Sign in
                  </motion.p>
                  {signInItems.map((s) => (
                    <motion.a key={s.label} href={s.href} onClick={close} className="mnav__sub" variants={item}>
                      {s.label}
                    </motion.a>
                  ))}
                </motion.div>
              )}
              <motion.div className="mnav__actions" variants={item}>
                <Button
                  variant="secondary"
                  aria-expanded={mobileSignIn}
                  aria-controls="mobile-sign-in"
                  onClick={() => setMobileSignIn((v) => !v)}
                >
                  Sign in
                </Button>
                <ButtonLink href={LINKS.findService}>Try Sagora</ButtonLink>
              </motion.div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}

/** Farmers and providers have separate accounts, so Sign in asks which one first. */
const signInItems = [
  { label: 'As a farmer', href: LINKS.farmerSignIn },
  { label: 'As a service provider', href: LINKS.providerSignIn },
]

const dropMotion = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.15 } },
  transition: { duration: 0.24, ease: EASE_OUT },
}

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
}
