import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { AdminPage } from '@/components/admin/AdminPage';
import { Switch } from '@/components/Switch';
import { ApiError, api } from '@/services/api';
import { toast } from '@/store/store';
import { card } from '@/ui/classes';
import { NewCategoryForm } from './NewCategoryForm';
import { NewCityForm } from './NewCityForm';

interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  suggestedMinPaise: number;
  suggestedMaxPaise: number;
  isActive: boolean;
  locationMode: 'SINGLE' | 'PICKUP_DROPOFF';
}

interface AdminCity {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

const BAR = 'skeleton rounded-md';

/**
 * Launch configuration as data: which categories and cities exist and are
 * switched on. Adding either is a data change, never a code change.
 */
export class AdminCategoriesView extends Component {
  static override template = xml`
    <AdminPage breadcrumbs="[{ label: 'Categories &amp; cities' }]">
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      <div t-else="" class="flex flex-col gap-8">
        <div>
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Categories</h2>
          <div t-if="!state.categories" class="flex flex-col gap-3" aria-hidden="true">
            <div t-foreach="[0, 1, 2]" t-as="i" t-key="i" class="h-16 w-full ${BAR}"/>
          </div>
          <div t-else="" class="flex flex-col gap-3">
            <div t-foreach="state.categories" t-as="c" t-key="c.id" t-att-class="rowClass">
              <div class="min-w-0">
                <p class="font-medium text-ink-900"><t t-out="c.name"/> <span class="text-sm font-normal text-ink-400">(<t t-out="c.slug"/>)</span></p>
                <p class="truncate text-sm text-ink-500" t-out="c.description"/>
                <p class="tabular text-xs text-ink-400" t-out="priceRange(c)"/>
              </div>
              <label class="sr-only" t-att-for="'mode-' + c.id">Locations for <t t-out="c.name"/></label>
              <select t-att-id="'mode-' + c.id" class="ml-auto h-9 rounded-input border border-line bg-paper-0 px-2 text-sm text-ink-900"
                t-on-change="(ev) => setLocationMode(c.id, ev.target.value)">
                <option value="SINGLE" t-att-selected="c.locationMode === 'SINGLE'">One place</option>
                <option value="PICKUP_DROPOFF" t-att-selected="c.locationMode === 'PICKUP_DROPOFF'">Pickup + drop-off</option>
              </select>
              <Switch checked="c.isActive" label="'Enable ' + c.name" onChange="(checked) => toggleCategory(c.id, checked)"/>
            </div>
          </div>
          <NewCategoryForm onCreated="reload"/>
        </div>

        <div>
          <h2 class="mb-3 text-[17px] font-medium text-ink-900">Cities</h2>
          <div t-if="!state.cities" class="flex flex-col gap-3" aria-hidden="true">
            <div t-foreach="[0, 1]" t-as="i" t-key="i" class="h-16 w-full ${BAR}"/>
          </div>
          <div t-else="" class="flex flex-col gap-3">
            <div t-foreach="state.cities" t-as="c" t-key="c.id" t-att-class="rowClass">
              <div class="min-w-0">
                <p class="font-medium text-ink-900"><t t-out="c.name"/>, <t t-out="c.state"/></p>
                <p class="tabular text-xs text-ink-400" t-out="cityDetail(c)"/>
              </div>
              <Switch checked="c.isActive" label="'Enable ' + c.name" onChange="(checked) => toggleCity(c.id, checked)"/>
            </div>
          </div>
          <NewCityForm onCreated="reload"/>
        </div>
      </div>
    </AdminPage>`;
  static components = { AdminPage, NewCategoryForm, NewCityForm, Switch };
  static override props = {};

  state = useState<{ categories: AdminCategory[] | null; cities: AdminCity[] | null; error: string | null }>({
    categories: null,
    cities: null,
    error: null,
  });
  rowClass = card('flex items-center justify-between gap-4 p-4');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  priceRange(c: AdminCategory): string {
    return `${formatPaise(c.suggestedMinPaise)} – ${formatPaise(c.suggestedMaxPaise)}`;
  }

  cityDetail(c: AdminCity): string {
    return `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)} · ${(c.radiusMeters / 1000).toFixed(0)} km radius`;
  }

  reload = () => {
    void this.load();
  };

  private async load() {
    try {
      const [categories, cities] = await Promise.all([
        api.get<{ data: AdminCategory[] }>('/admin/categories'),
        api.get<{ data: AdminCity[] }>('/admin/cities'),
      ]);
      if (this.disposed) return;
      this.state.categories = categories.data;
      this.state.cities = cities.data;
    } catch (error) {
      if (!this.disposed) {
        this.state.error = error instanceof ApiError ? error.message : 'Could not load categories and cities.';
      }
    }
  }

  toggleCategory = async (id: string, isActive: boolean) => {
    try {
      await api.patch(`/admin/categories/${id}`, { isActive });
      this.state.categories = this.state.categories?.map((r) => (r.id === id ? { ...r, isActive } : r)) ?? null;
      toast(isActive ? 'Category enabled' : 'Category disabled', { variant: 'success' });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not update the category.', { variant: 'error' });
    }
  };

  /** Only changes what the wizard asks for new tasks; existing tasks keep their locations. */
  setLocationMode = async (id: string, locationMode: string) => {
    try {
      await api.patch(`/admin/categories/${id}`, { locationMode });
      this.state.categories =
        this.state.categories?.map((r) => (r.id === id ? { ...r, locationMode: locationMode as AdminCategory['locationMode'] } : r)) ?? null;
      toast('Category updated', { variant: 'success' });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not update the category.', { variant: 'error' });
    }
  };

  toggleCity = async (id: string, isActive: boolean) => {
    try {
      await api.patch(`/admin/cities/${id}`, { isActive });
      this.state.cities = this.state.cities?.map((r) => (r.id === id ? { ...r, isActive } : r)) ?? null;
      toast(isActive ? 'City enabled' : 'City disabled', { variant: 'success' });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not update the city.', { variant: 'error' });
    }
  };
}
