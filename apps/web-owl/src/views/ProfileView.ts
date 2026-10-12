import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import type { PublicUser, PublicWorker } from '@onsite/types';
import { Page } from '@/components/Page';
import { TrustBadge } from '@/components/TrustBadge';
import { formatMemberSince } from '@/lib/format';
import { routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { card } from '@/ui/classes';

function isWorkerProfile(profile: PublicUser | PublicWorker): profile is PublicWorker {
  return 'ratingAvg' in profile;
}

const BAR = 'skeleton rounded-md';

/** Another user's public profile: only what the API exposes publicly, never contact details. */
export class ProfileView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Profile' }]" heading="false">
      <div class="mx-auto flex max-w-xl flex-col gap-4">
        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <div t-elif="!state.profile" class="flex items-center gap-4 p-2" aria-hidden="true">
          <div class="h-16 w-16 rounded-full ${BAR}"/>
          <div class="flex flex-col gap-2"><div class="h-6 w-32 ${BAR}"/><div class="h-4 w-20 ${BAR}"/></div>
        </div>

        <t t-else="">
          <div class="flex items-center gap-4 p-2">
            <img t-if="profile.avatarUrl" t-att-src="profile.avatarUrl" alt="" class="h-16 w-16 rounded-full object-cover"/>
            <div t-else="" class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-solid text-xl font-bold text-ink-900" t-out="initial"/>
            <div>
              <h1 class="text-2xl font-semibold tracking-tight text-ink-900" t-out="profile.displayName"/>
              <p t-if="profile.homeCity" class="text-sm text-ink-500" t-out="profile.homeCity"/>
            </div>
          </div>

          <div t-att-class="cardClass">
            <TrustBadge t-if="worker" worker="worker"/>
            <p t-else="" class="text-sm text-ink-500">
              Member since <t t-out="memberSince"/> · verification level <t t-out="profile.verificationLevel"/> of 5
            </p>
          </div>
        </t>
      </div>
    </Page>`;
  static components = { Page, TrustBadge };
  static override props = {};

  router = useState(routerState);
  state = useState<{ profile: PublicUser | PublicWorker | null; error: string | null }>({ profile: null, error: null });
  cardClass = card('p-6');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get profile(): PublicUser | PublicWorker {
    // Only rendered once loaded; the template guards on state.profile.
    return this.state.profile as PublicUser | PublicWorker;
  }

  get worker(): PublicWorker | null {
    const profile = this.state.profile;
    return profile && isWorkerProfile(profile) ? profile : null;
  }

  get initial(): string {
    return this.profile.displayName.charAt(0).toUpperCase();
  }

  get memberSince(): string {
    return formatMemberSince(this.profile.memberSince);
  }

  private async load() {
    const id = this.router.params['id'];
    try {
      const profile = await api.get<PublicUser | PublicWorker>(`/users/${id}/public`);
      if (!this.disposed) this.state.profile = profile;
    } catch (error) {
      if (!this.disposed) this.state.error = error instanceof ApiError ? error.message : 'Could not load this profile.';
    }
  }
}
