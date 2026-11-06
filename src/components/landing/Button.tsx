import type { ComponentPropsWithoutRef, ComponentPropsWithRef } from 'react'

type Variant = 'primary' | 'secondary'
type Size = 'sm' | 'md' | 'lg'

export const btnClass = (variant: Variant = 'primary', size: Size = 'md', extra = '') =>
  `btn btn--${variant} btn--${size} ${extra}`.trim()

type Props = { variant?: Variant; size?: Size } & ComponentPropsWithRef<'button'>

export function Button({ variant, size, className, children, ...rest }: Props) {
  return (
    <button type="button" className={btnClass(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}

type LinkProps = { variant?: Variant; size?: Size; href: string } & Omit<ComponentPropsWithoutRef<'a'>, 'href'>

/**
 * Looks like a button, goes somewhere in the app. A plain <a>, not next/link: the app has its
 * own root layout, so the browser loads it as a fresh page either way.
 */
export function ButtonLink({ variant, size, className, children, ...rest }: LinkProps) {
  return (
    <a className={btnClass(variant, size, className)} {...rest}>
      {children}
    </a>
  )
}
