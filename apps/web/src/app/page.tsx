import { TaskCardPreview } from '@/components/task-card-preview';
import { TaskTimelinePreview } from '@/components/task-timeline-preview';

const CATEGORIES = [
  { name: 'Product inspection', desc: 'Check a laptop before you buy it remotely.' },
  { name: 'Shop verification', desc: 'Confirm a supplier actually exists and operates.' },
  { name: 'Property inspection', desc: 'A video walkthrough before you commit to a flat.' },
  { name: 'Document collection', desc: 'Collect papers from an office, confirmed handover.' },
  { name: 'Local photography', desc: 'Photographs of a site, a signboard, a location.' },
  { name: 'Local research', desc: 'Answers to specific questions, asked in person.' },
];

const STEPS = [
  {
    n: '01',
    title: 'Describe the task',
    body: 'Where the work happens, what to check, what proof you need, and your budget.',
  },
  {
    n: '02',
    title: 'We fund it, then match it',
    body: 'Your payment is held before anyone sees the task. A verified person nearby accepts.',
  },
  {
    n: '03',
    title: 'Review the evidence',
    body: 'Photos, video, and GPS-verified location. Approve, and payment releases.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="flex items-center justify-between pb-16 sm:pb-24">
        <span className="text-lg font-bold tracking-tight text-ink-900">OnSite</span>
        <nav className="flex items-center gap-6 text-sm text-ink-500">
          <a href="#how-it-works" className="hover:text-ink-900">
            How it works
          </a>
          <a href="#categories" className="hover:text-ink-900">
            What you can ask for
          </a>
          <a
            href="/sign-up"
            className="rounded-input bg-brand-solid px-4 py-2 font-semibold text-white transition-colors duration-micro ease-onsite hover:bg-brand-700"
          >
            Get started
          </a>
        </nav>
      </header>

      <section className="grid gap-12 sm:grid-cols-2 sm:items-center sm:gap-8">
        <div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink-900 sm:text-5xl">
            Someone on the ground, wherever you need them.
          </h1>
          <p className="mt-5 max-w-prose text-lg text-ink-500">
            You live in Ahmedabad. You want a laptop inspected at a specific shop in Kolkata
            before you buy it. OnSite finds a verified person nearby to check it, photograph
            it, and confirm the price, then pays them only once you approve the evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/sign-up"
              className="rounded-input bg-brand-solid px-5 py-3 text-sm font-semibold text-white transition-colors duration-micro ease-onsite hover:bg-brand-700"
            >
              Post a task
            </a>
            <a
              href="/sign-up?role=worker"
              className="rounded-input border border-line bg-paper-0 px-5 py-3 text-sm font-semibold text-ink-900 transition-colors duration-micro ease-onsite hover:bg-paper-100"
            >
              Earn as a worker
            </a>
          </div>
          <p className="mt-6 text-xs text-ink-400">
            Available across India. Remote inspection and verification only.
          </p>
        </div>

        <div className="flex flex-col items-center gap-6 sm:items-end">
          <TaskCardPreview />
        </div>
      </section>

      <section id="how-it-works" className="mt-24 sm:mt-32">
        <h2 className="text-2xl font-bold tracking-tight text-ink-900">How it works</h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="tabular text-sm font-semibold text-brand-600">{step.n}</span>
              <h3 className="mt-2 text-lg font-semibold text-ink-900">{step.title}</h3>
              <p className="mt-1.5 text-sm text-ink-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-24 grid gap-12 sm:mt-32 sm:grid-cols-2 sm:items-center sm:gap-8">
        <div className="order-2 sm:order-1 flex justify-center sm:justify-start">
          <TaskTimelinePreview />
        </div>
        <div className="order-1 sm:order-2">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">
            Evidence, not assertions.
          </h2>
          <p className="mt-4 max-w-prose text-ink-500">
            Every step is timestamped. Every arrival is measured against the task location, not
            claimed. When someone says the work is done, you see exactly when, where, and with
            what proof — before your money moves.
          </p>
        </div>
      </section>

      <section id="categories" className="mt-24 sm:mt-32">
        <h2 className="text-2xl font-bold tracking-tight text-ink-900">
          Get someone you trust to verify something, anywhere in India
        </h2>
        <p className="mt-3 max-w-prose text-ink-500">
          We launch narrow on purpose. Six categories, chosen because their risks are
          understood and their evidence is verifiable.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c.name} className="rounded-card border border-line bg-paper-0 p-5 shadow-card">
              <h3 className="font-semibold text-ink-900">{c.name}</h3>
              <p className="mt-1 text-sm text-ink-500">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-24 border-t border-line pt-8 text-sm text-ink-400 sm:mt-32">
        <p>© 2026 OnSite. Available across India.</p>
      </footer>
    </main>
  );
}
