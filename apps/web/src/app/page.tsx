import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollReveal } from '@/components/ui/scroll-reveal';
import { StaggerItem, StaggerList } from '@/components/ui/stagger-list';
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
    <div className="bg-paper-50">
      {/* Hero band — the one place a full mesh-gradient wash is appropriate:
          first impression, no money or evidence on screen. */}
      <div className="mesh-bg relative overflow-hidden">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-8 sm:pb-24 sm:pt-10">
          <header className="flex items-center justify-between pb-16 sm:pb-24">
            <span className="text-lg font-bold tracking-tight text-ink-900">OnSite</span>
            <nav className="flex items-center gap-6 text-sm text-ink-500">
              <a href="#how-it-works" className="hidden hover:text-ink-900 sm:inline">
                How it works
              </a>
              <a href="#categories" className="hidden hover:text-ink-900 sm:inline">
                What you can ask for
              </a>
              <Button asChild size="sm">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </nav>
          </header>

          <ScrollReveal>
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
                  <Button asChild variant="gradient" size="lg">
                    <Link href="/sign-up">
                      Post a task
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <Link href="/sign-up?role=worker">Earn as a worker</Link>
                  </Button>
                </div>
                <p className="mt-6 text-xs text-ink-400">
                  Available across India. Remote inspection and verification only.
                </p>
              </div>

              <div className="flex flex-col items-center gap-6 sm:items-end">
                <TaskCardPreview />
              </div>
            </section>
          </ScrollReveal>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-6 pb-16 sm:pb-24">
        <ScrollReveal>
          <section id="how-it-works" className="mt-24 sm:mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">How it works</h2>
            <StaggerList className="mt-8 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step) => (
                <StaggerItem key={step.n}>
                  <span className="tabular text-sm font-semibold text-brand-600">{step.n}</span>
                  <h3 className="mt-2 text-lg font-semibold text-ink-900">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-ink-500">{step.body}</p>
                </StaggerItem>
              ))}
            </StaggerList>
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section className="mt-24 grid gap-12 sm:mt-32 sm:grid-cols-2 sm:items-center sm:gap-8">
            <div className="order-2 flex justify-center sm:order-1 sm:justify-start">
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
              <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-verified" aria-hidden />
                  GPS-verified arrival, measured against the task location
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-verified" aria-hidden />
                  Timestamped photo and video evidence
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-verified" aria-hidden />
                  Funds held in escrow until you approve
                </li>
              </ul>
            </div>
          </section>
        </ScrollReveal>

        <ScrollReveal>
          <section id="categories" className="mt-24 sm:mt-32">
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">
              Get someone you trust to verify something, anywhere in India
            </h2>
            <p className="mt-3 max-w-prose text-ink-500">
              We launch narrow on purpose. Six categories, chosen because their risks are
              understood and their evidence is verifiable.
            </p>
            <StaggerList className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((c) => (
                <StaggerItem key={c.name}>
                  <Card className="h-full p-5 transition-all duration-base ease-onsite hover:-translate-y-0.5 hover:shadow-float">
                    <h3 className="font-semibold text-ink-900">{c.name}</h3>
                    <p className="mt-1 text-sm text-ink-500">{c.desc}</p>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerList>
          </section>
        </ScrollReveal>

        <footer className="mt-24 border-t border-line pt-8 text-sm text-ink-400 sm:mt-32">
          <p>© 2026 OnSite. Available across India.</p>
        </footer>
      </main>
    </div>
  );
}
