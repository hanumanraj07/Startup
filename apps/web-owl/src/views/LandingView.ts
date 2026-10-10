import { Component, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { btn, card } from '@/ui/classes';
import { TaskCardPreview } from './landing/TaskCardPreview';
import { TaskTimelinePreview } from './landing/TaskTimelinePreview';

const CATEGORIES = [
  { name: 'Product inspection', desc: 'Check a laptop before you buy it remotely.' },
  { name: 'Shop verification', desc: 'Confirm a supplier actually exists and operates.' },
  { name: 'Property inspection', desc: 'A video walkthrough before you commit to a flat.' },
  { name: 'Document collection', desc: 'Collect papers from an office, confirmed handover.' },
  { name: 'Local photography', desc: 'Photographs of a site, a signboard, a location.' },
  { name: 'Local research', desc: 'Answers to specific questions, asked in person.' },
];

const STEPS = [
  { n: '01', title: 'Describe the task', body: 'Where the work happens, what to check, what proof you need, and your budget.' },
  {
    n: '02',
    title: 'We fund it, then match it',
    body: 'Your payment is held before anyone sees the task. A verified person nearby accepts.',
  },
  { n: '03', title: 'Review the evidence', body: 'Photos, video, and GPS-verified location. Approve, and payment releases.' },
];

const EVIDENCE_POINTS = [
  'GPS-verified arrival, measured against the task location',
  'Timestamped photo and video evidence',
  'Funds held in escrow until you approve',
];

/**
 * The marketing page. Copy is carried over from apps/web unchanged; the look
 * is the flat Odoo-style system rather than the gradient hero it replaced.
 */
export class LandingView extends Component {
  static override template = xml`
    <div class="bg-paper-50">
      <div class="border-b border-line bg-brand-50">
        <div class="mx-auto max-w-5xl px-6 pb-16 pt-6 sm:pb-24 sm:pt-8">
          <header class="flex items-center justify-between pb-14 sm:pb-20">
            <span class="text-lg font-semibold tracking-tight text-brand-700">OnSite</span>
            <nav class="flex items-center gap-6 text-sm text-ink-500">
              <a href="#how-it-works" class="hidden hover:text-ink-900 sm:inline">How it works</a>
              <a href="#categories" class="hidden hover:text-ink-900 sm:inline">What you can ask for</a>
              <Link to="'/sign-up'" class="smClass">Get started</Link>
            </nav>
          </header>

          <section class="grid gap-12 sm:grid-cols-2 sm:items-center sm:gap-8">
            <div>
              <h1 class="text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
                Someone on the ground, wherever you need them.
              </h1>
              <p class="mt-5 max-w-prose text-lg text-ink-500">
                You live in Ahmedabad. You want a laptop inspected at a specific shop in Kolkata before you buy it.
                OnSite finds a verified person nearby to check it, photograph it, and confirm the price, then pays
                them only once you approve the evidence.
              </p>
              <div class="mt-8 flex flex-wrap gap-3">
                <Link to="'/sign-up'" class="postClass">Post a task <Icon name="'arrow-right'" size="16"/></Link>
                <Link to="'/sign-up?role=worker'" class="workerClass">Earn as a worker</Link>
              </div>
              <p class="mt-6 text-xs text-ink-400">Available across India. Remote inspection and verification only.</p>
            </div>

            <div class="flex flex-col items-center gap-6 sm:items-end"><TaskCardPreview/></div>
          </section>
        </div>
      </div>

      <main class="mx-auto max-w-5xl px-6 pb-16 sm:pb-24">
        <section id="how-it-works" class="mt-20 sm:mt-28">
          <h2 class="text-2xl font-semibold tracking-tight text-ink-900">How it works</h2>
          <div class="mt-8 grid gap-8 sm:grid-cols-3">
            <div t-foreach="steps" t-as="step" t-key="step.n">
              <span class="tabular text-sm font-semibold text-brand-600" t-out="step.n"/>
              <h3 class="mt-2 text-lg font-medium text-ink-900" t-out="step.title"/>
              <p class="mt-1.5 text-sm text-ink-500" t-out="step.body"/>
            </div>
          </div>
        </section>

        <section class="mt-20 grid gap-12 sm:mt-28 sm:grid-cols-2 sm:items-center sm:gap-8">
          <div class="order-2 flex justify-center sm:order-1 sm:justify-start"><TaskTimelinePreview/></div>
          <div class="order-1 sm:order-2">
            <h2 class="text-2xl font-semibold tracking-tight text-ink-900">Evidence, not assertions.</h2>
            <p class="mt-4 max-w-prose text-ink-500">
              Every step is timestamped. Every arrival is measured against the task location, not claimed. When
              someone says the work is done, you see exactly when, where, and with what proof — before your money
              moves.
            </p>
            <ul class="mt-5 flex flex-col gap-2 text-sm text-ink-700">
              <li t-foreach="evidencePoints" t-as="point" t-key="point" class="flex items-center gap-2">
                <Icon name="'circle-check'" size="16" class="'shrink-0 text-verified'"/>
                <t t-out="point"/>
              </li>
            </ul>
          </div>
        </section>

        <section id="categories" class="mt-20 sm:mt-28">
          <h2 class="text-2xl font-semibold tracking-tight text-ink-900">
            Get someone you trust to verify something, anywhere in India
          </h2>
          <p class="mt-3 max-w-prose text-ink-500">
            We launch narrow on purpose. Six categories, chosen because their risks are understood and their evidence
            is verifiable.
          </p>
          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div t-foreach="categories" t-as="c" t-key="c.name" t-att-class="categoryClass">
              <h3 class="font-medium text-ink-900" t-out="c.name"/>
              <p class="mt-1 text-sm text-ink-500" t-out="c.desc"/>
            </div>
          </div>
        </section>

        <footer class="mt-20 border-t border-line pt-8 text-sm text-ink-400 sm:mt-28">
          <p>© 2026 OnSite. Available across India.</p>
        </footer>
      </main>
    </div>`;
  static components = { Icon, Link, TaskCardPreview, TaskTimelinePreview };
  static override props = {};

  steps = STEPS;
  categories = CATEGORIES;
  evidencePoints = EVIDENCE_POINTS;
  smClass = btn('primary', 'sm');
  postClass = btn('primary', 'lg');
  workerClass = btn('secondary', 'lg');
  categoryClass = card('h-full p-5');
}
