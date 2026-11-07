// All copy and imagery below comes from the Sagora Figma frames
// (Landing 10707:3762 — farmers, Landing 10724:7699 — service providers).

export type AudienceKey = 'farmers' | 'providers'

export type Photo = {
  src: string
  alt: string
  /** object-position used to keep the subject in frame */
  position?: string
  /** how Figma scales the image into its crop box: stretched ('fill') or cropped ('cover') */
  fit: 'fill' | 'cover'
}

export type Audience = {
  key: AudienceKey
  tab: string
  heading: string
  body: string
  /** text widths from the design, in Figma px */
  widths: { heading: number; body: number }
  cta: string
  photos: [Photo, Photo, Photo]
  stat: {
    value: number
    decimals: number
    /** headline text that follows the number */
    rest: string
    body: string
    widths: { heading: number; body: number }
  }
}

export const AUDIENCES: Record<AudienceKey, Audience> = {
  farmers: {
    key: 'farmers',
    tab: 'For farmers',
    heading: 'Get the services your farm needs.',
    widths: { heading: 780, body: 598 },
    body: 'Find and request agricultural services, review quotes, arrange payments and keep track of your booking',
    cta: 'Find a service provider',
    photos: [
      { src: '/img/farmer-1.webp', alt: 'A combine harvester working a field at sunset', fit: 'fill' },
      { src: '/img/farmer-2.webp', alt: 'Farmers harvesting beans along long rows of crops', position: '50% 50%', fit: 'cover' },
      { src: '/img/farmer-3.webp', alt: 'A farmer carrying a crate of freshly harvested produce', position: '50% 50%', fit: 'cover' },
    ],
    stat: {
      value: 44.5,
      decimals: 1,
      rest: ' of Sierra Leone’s total employment was in agriculture in 2025.',
      widths: { heading: 1003, body: 641 },
      body: 'We’re building a better connection between the farmers who need work done and the service providers who make it possible.',
    },
  },
  providers: {
    key: 'providers',
    tab: 'For service providers',
    heading: 'Put your equipment and expertise to work.',
    widths: { heading: 891, body: 751 },
    body: 'Connect with farmers looking for agricultural services, respond to requests, send quotes, and manage your jobs, equipment, and payments in one place.',
    cta: 'Join as a service provider',
    photos: [
      { src: '/img/provider-1.webp', alt: 'Aerial view of a tractor spraying a green field', fit: 'fill' },
      { src: '/img/provider-2.webp', alt: 'A worker spraying crops in a field of tall grass', fit: 'fill' },
      { src: '/img/provider-3.webp', alt: 'An agricultural drone flying low over rows of crops', fit: 'fill' },
    ],
    stat: {
      value: 2,
      decimals: 0,
      rest: ' Sierra Leone’s reported agricultural mechanisation rate.',
      widths: { heading: 791, body: 737 },
      body: 'As the country works to expand access to agricultural machinery, Sagora connects farmers who need services with providers who can deliver them.',
    },
  },
}

export const STEPS = [
  {
    title: 'Tell us what you need',
    body: 'Choose a service, share your farm details, location and preferred dates.',
  },
  {
    title: 'Review your quote',
    body: 'Receive a quote from a service provider and review the details before deciding.',
  },
  {
    title: 'Confirm & track your work',
    body: 'Accept the quote and complete payment. Track the job through to delivery.',
  },
] as const

/**
 * Answers 1–2 come from the design. The rest follow what the app's own Help screens say,
 * so the landing page never promises something Sagora does not do.
 */
export const FAQS: { q: string; answer: string }[] = [
  {
    q: 'What is Sagora?',
    // Reuses the approved hero description rather than inventing new copy.
    answer:
      'Sagora connects farmers with agricultural service providers for ploughing, planting and harvesting, while giving providers the tools to manage their equipment, jobs and payments.',
  },
  {
    q: 'What services can I request on Sagora?',
    answer:
      'Sagora currently focuses on ploughing, planting and harvesting services, helping farmers find providers for essential work throughout the farming season',
  },
  {
    q: 'Do I need an account to request a service?',
    answer:
      'No. Send your request and write down the tracking code you are given: with your phone number, it brings you back to your request. You can also create a Sagora account, so your requests, quotes and bookings stay together in one place.',
  },
  {
    q: 'When is my booking confirmed?',
    answer:
      'A request asks service providers for quotes. Your booking is confirmed once you accept a quote and your payment is in.',
  },
  {
    q: 'What if the work is not done properly?',
    answer:
      'When the provider reports the work as done, you can confirm it or raise a concern. Nothing is settled until you confirm.',
  },
  {
    q: 'How can I join Sagora as a service provider?',
    answer:
      'Create a provider account and tell us about your business, the services you offer and where you work. Once Sagora approves your business, farmer requests appear in your workspace and you can send quotes.',
  },
]

/** Where the page's buttons lead in the Sagora app. */
export const LINKS = {
  findService: '/request',
  findRequest: '/request/find',
  joinProvider: '/provider/sign-up',
  workspace: '/provider/dashboard',
  farmerSignIn: '/farmer/sign-in',
  providerSignIn: '/provider/sign-in',
} as const
