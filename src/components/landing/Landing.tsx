"use client"

import { MotionConfig } from 'motion/react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Audience } from './Audience'
import { Faq } from './Faq'
import { Footer } from './Footer'
import { Hero } from './Hero'
import { Loader } from './Loader'
import { Nav } from './Nav'
import { Process } from './Process'
import type { AudienceKey } from './content'

const SEEN_KEY = 'sagora:intro-seen'

function shouldSkipLoader() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

const noSubscribe = () => () => {}

export function Landing() {
  // The branded loader plays once per browser session. The server cannot know whether this
  // browser has seen it, so the page starts with it and the browser skips it straight away.
  const seen = useSyncExternalStore(noSubscribe, shouldSkipLoader, () => false)
  const [played, setPlayed] = useState(false)
  const intro = seen || played
  const [audience, setAudience] = useState<AudienceKey>('farmers')

  const finishIntro = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* storage can be unavailable; the loader simply plays again next time */
    }
    setPlayed(true)
  }, [])

  const showProviders = useCallback(() => setAudience('providers'), [])

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {!intro && <Loader onDone={finishIntro} />}
      <Nav intro={intro} onProviders={showProviders} />
      <main id="main">
        <Hero intro={intro} />
        <Process />
        <Audience active={audience} onChange={setAudience} />
        <Faq />
      </main>
      <Footer onProviders={showProviders} />
    </MotionConfig>
  )
}
