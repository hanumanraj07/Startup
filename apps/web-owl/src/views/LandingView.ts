import { Component, useRef, xml } from '@odoo/owl';
import { CategoryBadge } from '@/components/CategoryBadge';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { Logo } from '@/components/Logo';
import { useReveal } from '@/hooks/use-reveal';
import { btn, card, tappableCard } from '@/ui/classes';
import { HeroIllustration } from './landing/HeroIllustration';
import { TaskTimelinePreview } from './landing/TaskTimelinePreview';

const CATEGORIES = [
  { slug: 'product-inspection', name: 'Product inspection', desc: 'Check a laptop before you buy it remotely.' },
  { slug: 'shop-verification', name: 'Shop verification', desc: 'Confirm a supplier actually exists and operates.' },
  { slug: 'property-inspection', name: 'Property inspection', desc: 'A video walkthrough before you commit to a flat.' },
  { slug: 'document-collection', name: 'Document collection', desc: 'Collect papers from an office, confirmed handover.' },
  { slug: 'local-photography', name: 'Local photography', desc: 'Photographs of a site, a signboard, a location.' },
  { slug: 'local-research', name: 'Local research', desc: 'Answers to specific questions, asked in person.' },
];

const STEPS = [
  {
    n: '1',
    icon: 'file-text',
    title: 'Describe the task',
    body: 'Where the work happens, what to check, what proof you need, and your budget.',
  },
  {
    n: '2',
    icon: 'shield-check',
    title: 'We fund it, then match it',
    body: 'Your payment is held before anyone sees the task. A verified person nearby accepts.',
  },
  {
    n: '3',
    icon: 'badge-check',
    title: 'Review the evidence',
    body: 'Photos, video, and GPS-verified location. Approve, and payment releases.',
  },
];

const PROMISES = [
  { icon: 'shield-check', label: 'Payment held until you approve' },
  { icon: 'locate-fixed', label: 'GPS-verified arrival' },
  { icon: 'badge-check', label: 'ID-verified people' },
];

const EVIDENCE_POINTS = [
  'GPS-verified arrival, measured against the task location',
  'Timestamped photo and video evidence',
  'Funds held in escrow until you approve',
];

const REQUESTER_POINTS = [
  'Post in two minutes, from anywhere in India',
  'Pay once; the money is held, not sent',
  'Approve the proof, or raise an issue',
];

const WORKER_POINTS = [
  'Pick tasks near you, when you want',
  'See the payout before you accept',
  'Paid to your bank once the work is approved',
];

/**
 * The marketing page: a bright yellow hero in the style of Indian consumer
 * apps, then how it works, the two sides of the marketplace, the evidence
 * story (kept calm: it is about money), the categories and a closing call to
 * action. Sections slide in as they scroll into view.
 */
export class LandingView extends Component {
  static override template = xml`
    <div t-ref="root" class="overflow-x-clip bg-paper-0">
      <div class="relative bg-brand-solid">
        <div class="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(#141414_1px,transparent_1px)] [background-size:22px_22px]" aria-hidden="true"/>
        <div class="relative mx-auto max-w-6xl px-5 pb-20 pt-5 sm:px-6 sm:pb-28">
          <header class="flex items-center justify-between gap-4">
            <Link to="'/'" class="'rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900'" ariaLabel="'OnSite home'">
              <Logo inverse="true"/>
            </Link>
            <nav class="flex items-center gap-1 text-sm font-semibold text-ink-900 sm:gap-2">
              <a href="#how-it-works" class="hidden rounded-full px-3 py-2 hover:bg-black/5 md:inline">How it works</a>
              <a href="#categories" class="hidden rounded-full px-3 py-2 hover:bg-black/5 md:inline">What you can ask for</a>
              <Link to="'/sign-in'" class="'rounded-full px-3 py-2 hover:bg-black/5'">Sign in</Link>
              <Link to="'/sign-up'" class="getStartedClass">Get started</Link>
            </nav>
          </header>

          <section class="mt-10 grid items-center gap-12 sm:mt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
            <div>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-brand-solid">
                <Icon name="'map-pin'" size="14"/> Available across India
              </span>
              <h1 class="mt-5 text-[40px] font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
                Someone on the ground, wherever you need them.
              </h1>
              <p class="mt-5 max-w-xl text-lg leading-relaxed text-ink-700">
                You live in Ahmedabad. You want a laptop inspected at a specific shop in Kolkata before you buy it.
                OnSite finds a verified person nearby to check it, photograph it, and confirm the price, then pays
                them only once you approve the evidence.
              </p>
              <div class="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="'/sign-up'" class="postClass">Post a task <Icon name="'arrow-right'" size="18"/></Link>
                <Link to="'/sign-up?role=worker'" class="workerClass"><Icon name="'indian-rupee'" size="18"/> Earn as a worker</Link>
              </div>
              <ul class="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-ink-900">
                <li t-foreach="promises" t-as="p" t-key="p.label" class="flex items-center gap-1.5">
                  <Icon name="p.icon" size="16"/> <t t-out="p.label"/>
                </li>
              </ul>
            </div>

            <div class="page-enter [animation-delay:120ms]"><HeroIllustration/></div>
          </section>
        </div>
        <svg class="absolute bottom-[-1px] left-0 h-10 w-full sm:h-16" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 64 C 360 0 1080 0 1440 64 Z" fill="#fff"/>
        </svg>
      </div>

      <main>
        <section id="how-it-works" class="mx-auto max-w-6xl scroll-mt-6 px-5 pt-16 sm:px-6 sm:pt-24">
          <div class="reveal max-w-2xl">
            <p class="text-sm font-bold uppercase tracking-wider text-brand-700">How it works</p>
            <h2 class="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">Three steps. Your money moves last.</h2>
          </div>
          <ol class="mt-10 grid gap-5 sm:grid-cols-3">
            <li t-foreach="steps" t-as="step" t-key="step.n" t-att-class="stepClass" t-att-style="delay(step_index)">
              <div class="flex items-center justify-between">
                <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-solid text-ink-900"><Icon name="step.icon" size="24"/></span>
                <span class="tabular text-5xl font-extrabold text-paper-100" aria-hidden="true" t-out="step.n"/>
              </div>
              <h3 class="mt-5 text-lg font-bold text-ink-900" t-out="step.title"/>
              <p class="mt-1.5 text-[15px] leading-relaxed text-ink-500" t-out="step.body"/>
            </li>
          </ol>
        </section>

        <section class="mx-auto max-w-6xl px-5 pt-16 sm:px-6 sm:pt-24" aria-labelledby="two-sides">
          <h2 id="two-sides" class="reveal text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">One app, two ways to use it</h2>
          <div class="mt-8 grid gap-5 md:grid-cols-2">
            <div class="reveal relative overflow-hidden rounded-sheet bg-brand-50 p-7 sm:p-9">
              <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-solid"><Icon name="'search'" size="24"/></span>
              <h3 class="mt-5 text-2xl font-extrabold tracking-tight text-ink-900">Need something checked?</h3>
              <p class="mt-2 text-ink-700">Send a verified person to a shop, a flat or an office, and see it for yourself.</p>
              <ul class="mt-5 flex flex-col gap-2.5">
                <li t-foreach="requesterPoints" t-as="point" t-key="point" class="flex items-start gap-2 text-[15px] text-ink-900">
                  <Icon name="'circle-check'" size="18" class="'mt-0.5 shrink-0'"/> <t t-out="point"/>
                </li>
              </ul>
              <Link to="'/sign-up'" class="sidePostClass">Post a task <Icon name="'arrow-right'" size="16"/></Link>
            </div>
            <div class="reveal relative overflow-hidden rounded-sheet bg-tint-green p-7 sm:p-9" style="--reveal-delay: 120ms">
              <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-600 text-white"><Icon name="'indian-rupee'" size="24"/></span>
              <h3 class="mt-5 text-2xl font-extrabold tracking-tight text-ink-900">Earn near you</h3>
              <p class="mt-2 text-ink-700">Already out and about? Turn short visits nearby into income.</p>
              <ul class="mt-5 flex flex-col gap-2.5">
                <li t-foreach="workerPoints" t-as="point" t-key="point" class="flex items-start gap-2 text-[15px] text-ink-900">
                  <Icon name="'circle-check'" size="18" class="'mt-0.5 shrink-0 text-verified'"/> <t t-out="point"/>
                </li>
              </ul>
              <Link to="'/sign-up?role=worker'" class="sideWorkerClass">Start earning <Icon name="'arrow-right'" size="16"/></Link>
            </div>
          </div>
        </section>

        <section class="mx-auto mt-16 max-w-6xl px-5 sm:mt-24 sm:px-6">
          <div class="grid items-center gap-10 rounded-sheet bg-paper-50 p-6 sm:p-10 lg:grid-cols-2">
            <div class="reveal order-2 flex justify-center lg:order-1"><TaskTimelinePreview/></div>
            <div class="reveal order-1 lg:order-2">
              <p class="text-sm font-bold uppercase tracking-wider text-accent-600">Built on proof</p>
              <h2 class="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">Evidence, not assertions.</h2>
              <p class="mt-4 max-w-prose leading-relaxed text-ink-500">
                Every step is timestamped. Every arrival is measured against the task location, not claimed. When
                someone says the work is done, you see exactly when, where, and with what proof — before your money
                moves.
              </p>
              <ul class="mt-6 flex flex-col gap-3 text-[15px] text-ink-900">
                <li t-foreach="evidencePoints" t-as="point" t-key="point" class="flex items-center gap-3">
                  <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint-green text-verified"><Icon name="'check'" size="16"/></span>
                  <t t-out="point"/>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="categories" class="mx-auto max-w-6xl scroll-mt-6 px-5 pt-16 sm:px-6 sm:pt-24">
          <div class="reveal max-w-2xl">
            <p class="text-sm font-bold uppercase tracking-wider text-brand-700">What you can ask for</p>
            <h2 class="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
              Get someone you trust to verify something, anywhere in India
            </h2>
            <p class="mt-3 text-ink-500">
              We launch narrow on purpose. Six categories, chosen because their risks are understood and their evidence
              is verifiable.
            </p>
          </div>
          <div class="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <div t-foreach="categories" t-as="c" t-key="c.slug" t-att-class="categoryClass" t-att-style="delay(c_index % 3)">
              <CategoryBadge slug="c.slug" size="48"/>
              <h3 class="mt-4 font-bold text-ink-900" t-out="c.name"/>
              <p class="mt-1 text-sm leading-relaxed text-ink-500" t-out="c.desc"/>
            </div>
          </div>
        </section>

        <section class="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-24">
          <div class="reveal relative overflow-hidden rounded-sheet bg-ink-900 px-6 py-12 text-center sm:px-12 sm:py-16">
            <div class="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-solid opacity-25 blur-3xl" aria-hidden="true"/>
            <div class="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-accent-600 opacity-30 blur-3xl" aria-hidden="true"/>
            <h2 class="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Be there, <span class="text-brand-solid">without going there.</span>
            </h2>
            <p class="relative mx-auto mt-3 max-w-lg text-white/70">
              Post your first task in a couple of minutes. You only pay for work you approve.
            </p>
            <div class="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="'/sign-up'" class="ctaPostClass">Post a task <Icon name="'arrow-right'" size="18"/></Link>
              <Link to="'/sign-up?role=worker'" class="ctaWorkerClass">Earn as a worker</Link>
            </div>
          </div>
        </section>
      </main>

      <footer class="border-t border-line-light">
        <div class="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <Logo/>
            <p class="mt-2 text-sm text-ink-500">© 2026 OnSite. Available across India.</p>
          </div>
          <nav class="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-ink-500" aria-label="Footer">
            <a href="#how-it-works" class="hover:text-ink-900">How it works</a>
            <a href="#categories" class="hover:text-ink-900">Categories</a>
            <Link to="'/sign-in'" class="'hover:text-ink-900'">Sign in</Link>
            <Link to="'/licenses'" class="'hover:text-ink-900'">Open-source licences</Link>
          </nav>
        </div>
      </footer>
    </div>`;
  static components = { CategoryBadge, HeroIllustration, Icon, Link, Logo, TaskTimelinePreview };
  static override props = {};

  root = useRef('root');
  steps = STEPS;
  promises = PROMISES;
  categories = CATEGORIES;
  evidencePoints = EVIDENCE_POINTS;
  requesterPoints = REQUESTER_POINTS;
  workerPoints = WORKER_POINTS;

  getStartedClass = btn('dark', 'sm', 'rounded-full');
  postClass = btn('dark', 'lg', 'rounded-full');
  workerClass = btn('secondary', 'lg', 'rounded-full border-transparent');
  sidePostClass = btn('dark', 'default', 'mt-7 rounded-full');
  sideWorkerClass = btn('success', 'default', 'mt-7 rounded-full');
  ctaPostClass = btn('primary', 'lg', 'rounded-full');
  ctaWorkerClass = btn('ghost', 'lg', 'rounded-full text-white ring-1 ring-white/30 hover:bg-white/10');
  stepClass = card('reveal p-6');
  categoryClass = tappableCard('reveal p-4 sm:p-6');

  override setup() {
    useReveal(this.root);
  }

  delay(index: number): string {
    return `--reveal-delay: ${index * 90}ms`;
  }
}
