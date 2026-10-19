import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { LocationPicker } from '@/components/LocationPicker';
import { Page } from '@/components/Page';
import type { CategoryView, PickedLocation, WorkerProfile } from '@/lib/api-types';
import { nearestListedCity } from '@/lib/india-places';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { refetchUser } from '@/services/session';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, LABEL } from '@/ui/classes';

interface OnboardingState {
  categories: CategoryView[] | null;
  loadError: string | null;
  /** Set when editing an existing worker profile rather than creating one. */
  existing: WorkerProfile | null;
  base: PickedLocation | null;
  radiusKm: number;
  selected: string[];
  submitting: boolean;
  error: string | null;
}

/**
 * Becoming a worker, or changing your work area: the exact point tasks are
 * measured from, a working radius and the categories you accept. The point is
 * set on a map, not by picking a city — a base at a city centre is what let a
 * worker living 60 km away see that city's tasks (2026-10-18). The base point
 * stays private: requesters never see it.
 */
export class WorkerOnboardingView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: state.existing ? 'Your work area' : 'Become a worker' }]">
      <div class="mx-auto flex max-w-xl flex-col gap-4">
        <p class="text-sm text-ink-500" t-out="state.existing ? 'Change where you start from, how far you travel, and what you do.' : 'Tell us where you work from and what you’re good at.'"/>

        <p t-if="state.loadError" role="alert" class="text-sm text-dispute" t-out="state.loadError"/>

        <section t-att-class="cardClass">
          <div class="${CARD_HEADER}">
            <h2 class="${CARD_TITLE}">Where do you start from?</h2>
            <p class="${CARD_DESCRIPTION}">
              Usually your home or where you spend the day. Tasks are measured from this exact point, and it is never shown to requesters.
            </p>
          </div>
          <div class="${CARD_CONTENT} flex flex-col gap-4">
            <LocationPicker t-if="state.loaded" id="'worker-base'" tone="'pickup'" value="state.base or undefined" onChange="setBase"
              showDetails="false" searchPlaceholder="'Search your area, street or landmark'"/>
            <div t-else="" class="skeleton h-[300px] rounded-card" aria-hidden="true"/>
            <div class="flex flex-col gap-1.5">
              <label for="radius" class="${LABEL}">How far will you travel? <t t-out="state.radiusKm"/> km</label>
              <input id="radius" type="range" min="1" max="50" t-att-value="state.radiusKm" class="w-full accent-brand-600" t-on-input="onRadius"/>
              <p class="text-xs text-ink-400">You will only see and be offered tasks within this distance of your starting point.</p>
            </div>
          </div>
        </section>

        <section t-att-class="cardClass">
          <div class="${CARD_HEADER}">
            <h2 class="${CARD_TITLE}">Categories</h2>
            <p class="${CARD_DESCRIPTION}">Choose every kind of task you’re willing to accept.</p>
          </div>
          <div class="${CARD_CONTENT}">
            <div class="grid gap-2 sm:grid-cols-2">
              <button t-foreach="state.categories or []" t-as="c" t-key="c.id" type="button"
                t-att-class="categoryClass(c)" t-att-aria-pressed="isSelected(c) ? 'true' : 'false'"
                t-on-click="() => toggleCategory(c)">
                <Icon name="c.icon" size="16"/>
                <span t-out="c.name"/>
                <span t-if="isSelected(c)" class="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-brand-solid">
                  <Icon name="'check'" size="10"/>
                </span>
              </button>
            </div>
          </div>
        </section>

        <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

        <button type="button" t-att-class="submitClass" t-att-disabled="!canSubmit or state.submitting"
          t-att-aria-busy="state.submitting ? 'true' : null" t-on-click="submit">
          <span t-if="state.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden="true"/>
          <t t-out="state.existing ? 'Save changes' : 'Start finding work'"/>
        </button>
      </div>
    </Page>`;
  static components = { Icon, LocationPicker, Page };
  static override props = {};

  state = useState<OnboardingState & { loaded: boolean }>({
    categories: null,
    loadError: null,
    existing: null,
    base: null,
    radiusKm: 10,
    selected: [],
    submitting: false,
    error: null,
    loaded: false,
  });

  cardClass = card();
  submitClass = btn('primary', 'default', 'w-full');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get canSubmit(): boolean {
    return this.state.base !== null && this.state.selected.length > 0;
  }

  isSelected(c: CategoryView): boolean {
    return this.state.selected.includes(c.slug);
  }

  categoryClass(c: CategoryView): string {
    const tone = this.isSelected(c)
      ? 'border-ink-900 bg-brand-50 text-ink-900'
      : 'border-line bg-paper-0 text-ink-700 hover:bg-paper-100';
    return (
      'relative flex min-h-[44px] items-center gap-2 rounded-input border p-3 text-left text-sm transition-colors duration-micro ease-onsite ' +
      `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 ${tone}`
    );
  }

  setBase = (location: PickedLocation | null) => {
    this.state.base = location;
  };

  toggleCategory = (c: CategoryView) => {
    const { state } = this;
    state.selected = state.selected.includes(c.slug) ? state.selected.filter((s) => s !== c.slug) : [...state.selected, c.slug];
  };

  onRadius = (ev: Event) => {
    this.state.radiusKm = Number((ev.target as HTMLInputElement).value);
  };

  private async load() {
    try {
      const [categories, existing] = await Promise.all([
        api.get<{ data: CategoryView[] }>('/categories'),
        api.get<WorkerProfile>('/workers/me').catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
      ]);
      if (this.disposed) return;
      this.state.categories = categories.data;
      if (existing) {
        this.state.existing = existing;
        this.state.base = {
          latitude: existing.baseLocation.latitude,
          longitude: existing.baseLocation.longitude,
          suggestedAddress: '',
          details: '',
        };
        this.state.radiusKm = Math.round(existing.workingRadiusMeters / 1000);
        this.state.selected = existing.categories.map((c) => c.slug);
      }
    } catch {
      if (!this.disposed) this.state.loadError = 'Could not load your details. Refresh to try again.';
    } finally {
      if (!this.disposed) this.state.loaded = true;
    }
  }

  submit = async () => {
    const { state } = this;
    const base = state.base;
    if (!base || state.selected.length === 0) return;
    state.submitting = true;
    state.error = null;
    const body = {
      baseLocation: { latitude: base.latitude, longitude: base.longitude },
      // A display label only ("within 10 km of Ahmedabad"); the point is what is measured from.
      baseCity: nearestListedCity(base.latitude, base.longitude)?.city.name ?? 'India',
      workingRadiusMeters: state.radiusKm * 1000,
      categorySlugs: state.selected,
    };
    try {
      if (state.existing) {
        await api.patch('/workers/me', body);
        toast('Work area saved', { description: 'Your feed now uses your new starting point.', variant: 'success' });
      } else {
        await api.post('/workers/me', body);
        await refetchUser();
        toast('Worker profile created', { description: 'Browse nearby tasks whenever you’re ready.', variant: 'success' });
      }
      navigate('/feed');
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not save your worker profile. Try again.';
    } finally {
      state.submitting = false;
    }
  };
}
