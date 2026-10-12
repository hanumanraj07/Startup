import { Component, useState, xml } from '@odoo/owl';
import { CategoryBadge } from '@/components/CategoryBadge';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { formatMemberSince } from '@/lib/format';
import { store } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE } from '@/ui/classes';
import { NotificationsCard } from './dashboard/NotificationsCard';
import { PhoneVerification } from './dashboard/PhoneVerification';
import { StatusRow } from './dashboard/StatusRow';

const SHOWCASE_CATEGORIES = [
  'product-inspection',
  'shop-verification',
  'property-inspection',
  'document-collection',
  'local-photography',
  'local-research',
];

/**
 * Home after sign-in: a greeting, the two things people come here to do (post
 * a task, find work) as big tappable cards, then account status. The status
 * card stays plain: it is about identity.
 */
export class DashboardView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Home' }]" heading="false">
      <div t-if="user" class="flex flex-col gap-4">
        <div>
          <h1 class="text-[28px] font-extrabold leading-tight tracking-tight text-ink-900">Hi, <t t-out="firstName"/></h1>
          <p class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <span class="inline-flex items-center gap-1 rounded-full bg-tint-green px-2.5 py-0.5 text-xs font-semibold text-verified">
              <Icon name="'badge-check'" size="14"/> Level <t t-out="user.verificationLevel"/> of 5
            </span>
            Member since <t t-out="memberSince"/>
          </p>
        </div>

        <div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div class="relative overflow-hidden rounded-sheet bg-brand-solid p-5 sm:p-6">
            <div class="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(#141414_1px,transparent_1px)] [background-size:20px_20px]" aria-hidden="true"/>
            <div class="relative">
              <h2 class="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Need something checked?</h2>
              <p class="mt-1 max-w-md text-[15px] text-black/75">Get a verified local person to inspect, verify or collect something.</p>
              <div class="-mx-5 mt-5 flex gap-2.5 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6" aria-hidden="true">
                <span t-foreach="showcase" t-as="slug" t-key="slug" class="flex shrink-0 rounded-2xl bg-white p-1.5 shadow-card">
                  <CategoryBadge slug="slug" size="44"/>
                </span>
              </div>
              <Link to="'/tasks/new'" class="primaryLinkClass"><Icon name="'plus'" size="18"/> Post a task</Link>
            </div>
          </div>

          <div class="flex flex-col rounded-sheet bg-tint-green p-5 sm:p-6">
            <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-600 text-white"><Icon name="workerIcon" size="22"/></span>
            <h2 class="mt-4 text-xl font-extrabold tracking-tight text-ink-900" t-out="workerTitle"/>
            <p class="mt-1 text-[15px] text-ink-700" t-out="workerDescription"/>
            <div class="mt-auto pt-5">
              <Link to="user.hasWorkerProfile ? '/feed' : '/worker/onboarding'" class="secondaryLinkClass">
                <t t-out="workerCta"/> <Icon name="'arrow-right'" size="16"/>
              </Link>
            </div>
          </div>
        </div>

        <div t-att-class="cardClass">
          <div class="${CARD_HEADER}">
            <h2 class="${CARD_TITLE}">Account status</h2>
            <p class="${CARD_DESCRIPTION}">Email verification is the minimum to post or accept any task. Phone is optional.</p>
          </div>
          <div class="${CARD_CONTENT} flex flex-col gap-4">
            <StatusRow verified="user.emailVerified" label="'Email verified'"/>
            <p t-if="!user.emailVerified" class="pl-6 text-sm text-ink-400">
              Check your inbox for the link sent when you signed up.
            </p>

            <StatusRow verified="user.phoneVerified" label="'Phone verified (optional)'"/>
            <PhoneVerification t-if="!user.phoneVerified"/>

            <div t-if="user.hasWorkerProfile" class="flex items-center justify-between gap-3 border-t border-line-light pt-4">
              <div>
                <p class="text-sm font-medium text-ink-900">Identity verification (level <t t-out="user.verificationLevel"/>/5)</p>
                <p class="text-sm text-ink-400">Required to accept tasks above ₹1,000.</p>
              </div>
              <Link to="'/kyc'" class="smallSecondaryLinkClass">Get verified</Link>
            </div>
          </div>
        </div>

        <NotificationsCard/>
      </div>
    </Page>`;
  static components = { CategoryBadge, Icon, Link, NotificationsCard, Page, PhoneVerification, StatusRow };
  static override props = {};

  store = useState(store);

  showcase = SHOWCASE_CATEGORIES;
  cardClass = card();
  primaryLinkClass = btn('dark', 'lg', 'mt-5 rounded-full');
  secondaryLinkClass = btn('success', 'default', 'rounded-full');
  smallSecondaryLinkClass = btn('secondary', 'sm');

  get user() {
    return this.store.user;
  }

  get firstName(): string {
    return this.user?.displayName.trim().split(/\s+/)[0] ?? '';
  }

  get workerIcon(): string {
    return this.user?.hasWorkerProfile ? 'radar' : 'indian-rupee';
  }

  get memberSince(): string {
    return this.user ? formatMemberSince(this.user.memberSince) : '';
  }

  get workerTitle(): string {
    return this.user?.hasWorkerProfile ? 'Find work nearby' : 'Become a worker';
  }

  get workerDescription(): string {
    return this.user?.hasWorkerProfile
      ? 'Browse tasks near your base location and start earning.'
      : 'Set up your worker profile to start accepting tasks.';
  }

  get workerCta(): string {
    return this.user?.hasWorkerProfile ? 'Browse the feed' : 'Get started';
  }
}
