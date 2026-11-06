"use client"

import { motion, type Variants } from 'motion/react'
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { fadeUp, reveal, STAGGER, VIEWPORT } from './motion'

type RevealProps = {
  as?: 'div' | 'section' | 'p' | 'h2' | 'h3' | 'li' | 'ul' | 'footer' | 'span'
  delay?: number
  duration?: number
  variants?: Variants
  /** Stagger direct <Reveal.Item> children instead of animating as one block. */
  stagger?: number
  amount?: number
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'children'>

/**
 * Scroll-triggered reveal. Plays once when the element enters the viewport.
 * With `stagger`, it acts as an orchestrator for nested <RevealItem>s.
 */
export function Reveal({
  as = 'div',
  delay = 0,
  duration,
  variants = fadeUp,
  stagger,
  amount,
  children,
  ...rest
}: RevealProps) {
  const Comp = motion[as] as ElementType
  const viewport = amount ? { ...VIEWPORT, amount } : VIEWPORT
  // Each <Reveal> owns its own trigger; never inherit a parent's variant state.
  if (stagger !== undefined) {
    return (
      <Comp
        inherit={false}
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
        {...rest}
      >
        {children}
      </Comp>
    )
  }
  return (
    <Comp
      inherit={false}
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={variants}
      transition={reveal(delay, duration)}
      {...rest}
    >
      {children}
    </Comp>
  )
}

type ItemProps = {
  as?: 'div' | 'p' | 'h2' | 'h3' | 'li' | 'span'
  variants?: Variants
  duration?: number
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'children'>

export function RevealItem({ as = 'div', variants = fadeUp, duration, children, ...rest }: ItemProps) {
  const Comp = motion[as] as ElementType
  return (
    <Comp variants={variants} transition={reveal(0, duration)} {...rest}>
      {children}
    </Comp>
  )
}

export { STAGGER }
