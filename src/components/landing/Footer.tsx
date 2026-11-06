"use client"

import { LINKS } from './content'
import { settle } from './motion'
import { ButtonLink } from './Button'
import { Reveal, RevealItem } from './Reveal'

type Link = { label: string; href?: string; onClick?: () => void }

export function Footer({ onProviders }: { onProviders: () => void }) {
  const columns: { title: string; links: Link[] }[] = [
    {
      title: 'For farmers',
      links: [
        { label: 'Find a service', href: LINKS.findService },
        { label: 'How it works', href: '#how-it-works' },
        { label: 'Frequently asked questions', href: '#faq' },
      ],
    },
    {
      title: 'For providers',
      links: [
        { label: 'Offer your services', href: '#audience', onClick: onProviders },
        { label: 'Provider workspace', href: LINKS.workspace },
        { label: 'Provider FAQs', href: '#faq' },
      ],
    },
    {
      title: 'Company',
      links: [
        // Contact us and Legal come back once the support details and legal pages exist.
        { label: 'About Sagora', href: '#about' },
      ],
    },
  ]

  return (
    <footer className="footer">
      <div className="footer__top">
        <Reveal stagger={0.08} className="footer__cta">
          <RevealItem as="h2" className="footer__title">
            Good work starts with the right people
          </RevealItem>
          <RevealItem as="p" className="footer__text">
            Whether you need agricultural services or you provide them. Sagora brings the two sides together.
          </RevealItem>
          <RevealItem className="footer__buttons">
            <ButtonLink href={LINKS.findService}>Find a service provider</ButtonLink>
            <ButtonLink variant="secondary" href={LINKS.joinProvider}>
              Join as a provider
            </ButtonLink>
          </RevealItem>
        </Reveal>

        <Reveal as="div" stagger={0.08} delay={0.1} className="footer__cols">
          {columns.map((c) => (
            <RevealItem key={c.title} className="footer__col">
              <h3>{c.title}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <a className="ulink" href={l.href} onClick={l.onClick}>
                        {l.label}
                      </a>
                    ) : (
                      <button type="button" className="ulink" onClick={l.onClick}>
                        {l.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </RevealItem>
          ))}
        </Reveal>
      </div>

      <Reveal className="footer__logo" variants={settle} duration={1}>
        <img src="/brand/logo-wordmark.svg" alt="Sagora" width={497} height={129} loading="lazy" />
      </Reveal>
    </footer>
  )
}
