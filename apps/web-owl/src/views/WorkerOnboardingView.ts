import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Page } from '@/components/Page';
import type { CategoryView, CityView } from '@/lib/api-types';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { refetchUser } from '@/services/session';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, LABEL } from '@/ui/classes';

interface OnboardingState {
  categories: CategoryView[] | null;
  cities: CityView[] | null;
  loadError: string | null;
  city: CityView | null;
  radiusKm: number;
  selected: string[];
  submitting: boolean;
  error: string | null;
}

/**
 * Becoming a worker: a base city (the centre tasks are measured from), a
 * working radius and the categories the worker will accept. The server
 * decides everything else; this only asks.
 */
export class WorkerOnboardingView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Become a worker' }]">
      <div class="mx-auto flex max-w-xl flex-col gap-4">
        <p class="text-sm text-ink-500">Tell us where you work from and what you’re good at.</p>

        <p t-if="state.loadError" role="alert" class="text-sm text-dispute" t-out="state.loadError"/>

        <section t-att-class="cardClass">
          <div class="${CARD_HEADER}">
            <h2 class="${CARD_TITLE}">Base location</h2>
            <p class="${CARD_DESCRIPTION}">The center point tasks are measured from.</p>
          </div>
          <div class="${CARD_CONTENT} flex flex-col gap-4">
            <div class="flex flex-wrap gap-2">
              <button t-foreach="state.cities or []" t-as="c" t-key="c.id" type="button"
                t-att-class="cityClass(c)" t-att-aria-pressed="isCity(c) ? 'true' : 'false'"
                t-on-click="() => selectCity(c)">
                <Icon name="'map-pin'" size="16"/> <t t-out="c.name"/>
              </button>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="radius" class="${LABEL}">Working radius: <t t-out="state.radiusKm"/> km</label>
              <input id="radius" type="range" min="1" max="50" t-att-value="state.radiusKm" class="w-full accent-brand-600" t-on-input="onRadius"/>
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
          <span t-if="state.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
          Start finding work
        </button>
      </div>
    </Page>`;
  static components = { Icon, Page };
  static override props = {};

  state = useState<OnboardingState>({
    categories: null,
    cities: null,
    loadError: null,
    city: null,
    radiusKm: 10,
    selected: [],
    submitting: false,
    error: null,
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
    return this.state.city !== null && this.state.selected.length > 0;
  }

  isCity(c: CityView): boolean {
    return this.state.city?.id === c.id;
  }

  isSelected(c: CategoryView): boolean {
    return this.state.selected.includes(c.slug);
  }

  cityClass(c: CityView): string {
    return btn(this.isCity(c) ? 'primary' : 'secondary', 'sm');
  }

  categoryClass(c: CategoryView): string {
    const tone = this.isSelected(c)
      ? 'border-ink-900 bg-brand-50 text-ink-900'
      : 'border-line bg-paper-0 text-ink-700 hover:bg-paper-100';
    return (
      'relative flex items-center gap-2 rounded-input border p-3 text-left text-sm transition-colors duration-micro ease-onsite ' +
      `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 ${tone}`
    );
  }

  selectCity = (c: CityView) => {
    this.state.city = c;
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
      const [categories, cities] = await Promise.all([
        api.get<{ data: CategoryView[] }>('/categories'),
        api.get<{ data: CityView[] }>('/cities'),
      ]);
      if (this.disposed) return;
      this.state.categories = categories.data;
      this.state.cities = cities.data;
    } catch {
      if (!this.disposed) this.state.loadError = 'Could not load categories and cities. Refresh to try again.';
    }
  }

  submit = async () => {
    const { state } = this;
    const city = state.city;
    if (!city || state.selected.length === 0) return;
    state.submitting = true;
    state.error = null;
    try {
      await api.post('/workers/me', {
        baseLocation: { latitude: city.latitude, longitude: city.longitude },
        baseCity: city.name,
        workingRadiusMeters: state.radiusKm * 1000,
        categorySlugs: state.selected,
      });
      await refetchUser();
      toast('Worker profile created', { description: 'Browse nearby tasks whenever you’re ready.', variant: 'success' });
      navigate('/feed');
    } catch (error) {
      state.error = error instanceof ApiError ? error.message : 'Could not create your worker profile. Try again.';
    } finally {
      state.submitting = false;
    }
  };
}
