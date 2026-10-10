import { Component, useState, xml } from '@odoo/owl';
import { CategoryBadge } from '@/components/CategoryBadge';
import { Link } from '@/components/Link';
import { Page } from '@/components/Page';
import { formatMemberSince } from '@/lib/format';
import { store } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE } from '@/ui/classes';
import { NotificationsCard } from './dashboard/NotificationsCard';
import { PhoneVerification } from './dashboard/PhoneVerification';
import { StatusRow } from './dashboard/StatusRow';

const SHOWCASE_CATEGORIES = ['product-inspection', 'shop-verification', 'property-inspection', 'local-photography'];

export class DashboardView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Dashboard' }]">
      <div t-if="user" class="flex flex-col gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-ink-900">Welcome, <t t-out="user.displayName"/></h1>
          <p class="mt-1 text-sm text-ink-500">
            Verification level <t t-out="user.verificationLevel"/> of 5 · member since <t t-out="memberSince"/>
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div t-att-class="cardClass">
            <div class="${CARD_HEADER}">
              <h2 class="${CARD_TITLE}">Post a task</h2>
              <p class="${CARD_DESCRIPTION}">Get a verified local person to inspect, verify or collect something.</p>
            </div>
            <div class="${CARD_CONTENT} flex flex-col gap-4">
              <div class="flex gap-3">
                <CategoryBadge t-foreach="showcase" t-as="slug" t-key="slug" slug="slug" size="44"/>
              </div>
              <Link to="'/tasks/new'" class="primaryLinkClass">Create a task</Link>
            </div>
          </div>

          <div t-att-class="cardClass">
            <div class="${CARD_HEADER}">
              <h2 class="${CARD_TITLE}" t-out="workerTitle"/>
              <p class="${CARD_DESCRIPTION}" t-out="workerDescription"/>
            </div>
            <div class="${CARD_CONTENT}">
              <Link to="user.hasWorkerProfile ? '/feed' : '/worker/onboarding'" class="secondaryLinkClass">
                <t t-out="workerCta"/>
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

            <div t-if="user.hasWorkerProfile" class="flex items-center justify-between gap-3 border-t border-line pt-4">
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
  static components = { CategoryBadge, Link, NotificationsCard, Page, PhoneVerification, StatusRow };
  static override props = {};

  store = useState(store);

  showcase = SHOWCASE_CATEGORIES;
  cardClass = card();
  primaryLinkClass = btn('primary');
  secondaryLinkClass = btn('secondary');
  smallSecondaryLinkClass = btn('secondary', 'sm');

  get user() {
    return this.store.user;
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
