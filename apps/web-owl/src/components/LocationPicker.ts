import { Component, onMounted, onWillUnmount, useRef, useState, xml } from '@odoo/owl';
import type { PickedLocation, PlaceView } from '@/lib/api-types';
import { INDIA_CENTRE, INDIA_STATES } from '@/lib/india-places';
import { api } from '@/services/api';
import { getPosition } from '@/services/geo';
import { createMap, type MapLibreMap } from '@/services/map';
import { input } from '@/ui/classes';
import { Combobox, type ComboboxOption } from './Combobox';
import { Icon } from './Icon';
import { TextAreaField } from './TextAreaField';

/** Below this zoom the centre pin is too coarse to be a place a worker can walk to. */
export const MIN_PIN_ZOOM = 14;
const PLACE_ZOOM = 17;
const CITY_ZOOM = 12.5;
const SEARCH_DEBOUNCE_MS = 350;
const REVERSE_DEBOUNCE_MS = 500;

type PinTone = 'task' | 'pickup' | 'dropoff';

/**
 * Choosing a place the way ride apps do: search for it, or jump to a state
 * and city, then drag the map until the fixed centre pin sits on the exact
 * spot (or use the device location). The point under the pin is the answer;
 * the address shown under the map is looked up for it, and the user can add
 * the details a worker needs (shop name, floor, landmark).
 *
 * Emits null until the map is zoomed in enough to mean a specific place, so a
 * state-wide view can never become a task location by accident. The server
 * still checks the point is in India.
 */
export class LocationPicker extends Component {
  static override template = xml`
    <div class="flex flex-col gap-3">
      <div class="relative" t-on-focusout="onSearchFocusOut">
        <label t-att-for="searchId" class="sr-only" t-out="props.searchLabel or 'Search for a place'"/>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true">
            <Icon name="'search'" size="18"/>
          </span>
          <input t-att-id="searchId" type="search" role="combobox" autocomplete="off" aria-autocomplete="list"
            t-att-aria-expanded="state.resultsOpen ? 'true' : 'false'" t-att-aria-controls="resultsId"
            t-att-aria-activedescendant="activeResultId"
            t-att-placeholder="props.searchPlaceholder or 'Search a shop, street or landmark'"
            t-att-class="searchClass" t-att-value="state.query"
            t-on-input="onSearchInput" t-on-keydown="onSearchKeydown" t-on-focus="onSearchFocus"/>
        </div>
        <ul t-if="state.resultsOpen" t-att-id="resultsId" role="listbox" aria-label="Places"
          class="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line-light bg-paper-0 p-1 shadow-float">
          <li t-if="state.searching and state.results.length === 0" class="px-3 py-3 text-sm text-ink-400">Searching…</li>
          <li t-elif="state.results.length === 0" class="px-3 py-3 text-sm text-ink-500">
            No places found. Try a nearby landmark, or move the map instead.
          </li>
          <li t-foreach="state.results" t-as="place" t-key="place_index" t-att-id="resultId(place_index)" role="option"
            t-att-aria-selected="place_index === state.activeResult ? 'true' : 'false'"
            t-att-class="resultClass(place_index)"
            t-on-mousedown.prevent="() => choosePlace(place)">
            <Icon name="'map-pin'" size="16"/>
            <span class="min-w-0">
              <span class="block truncate font-medium text-ink-900" t-out="place.name"/>
              <span class="block truncate text-xs text-ink-500" t-out="place.address"/>
            </span>
          </li>
        </ul>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <Combobox id="props.id + '-state'" label="'State'" options="stateOptions" value="state.stateName"
          placeholder="'Search states'" onSelect="selectState"/>
        <Combobox id="props.id + '-city'" label="'City'" options="cityOptions" value="state.cityName"
          placeholder="state.stateName ? 'Search cities' : 'Pick a state first'" disabled="!state.stateName"
          emptyText="'Not listed? Search for the place above.'" onSelect="selectCity"/>
      </div>

      <div class="relative h-[300px] overflow-hidden rounded-card border border-line-light bg-paper-100 sm:h-[340px]">
        <!-- MapLibre gives its element position: relative, so it fills a positioned wrapper rather than being absolute itself. -->
        <div class="absolute inset-0">
          <div t-ref="map" class="h-full w-full" aria-label="Map. Drag it so the pin sits on the exact spot." role="region"/>
        </div>
        <div t-if="!state.mapReady and !state.mapFailed" class="skeleton absolute inset-0" aria-hidden="true"/>
        <div t-if="state.mapFailed" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-500">
          The map can’t be shown on this device. Search for the place above, or use your current location.
        </div>

        <t t-if="state.mapReady">
          <span class="pointer-events-none absolute left-1/2 top-1/2 h-2 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 blur-[1px]" aria-hidden="true"/>
          <span t-att-class="pinClass" aria-hidden="true">
            <svg width="36" height="46" viewBox="0 0 36 46" fill="none">
              <path d="M18 45C18 45 34 28.5 34 17A16 16 0 0 0 2 17C2 28.5 18 45 18 45Z" t-att-fill="pinFill" stroke="#141414" stroke-width="2"/>
              <circle cx="18" cy="17" r="6" fill="#fff"/>
            </svg>
          </span>
          <p t-if="state.zoomTooLow" class="pointer-events-none absolute left-3 right-3 top-3 rounded-full bg-ink-900/85 px-3 py-1.5 text-center text-xs font-medium text-white">
            Zoom in to put the pin on the exact spot
          </p>
        </t>

        <button type="button" t-att-class="locateClass" t-att-disabled="state.locating" t-on-click="useMyLocation"
          aria-label="Use my current location">
          <span t-if="state.locating" class="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden="true"/>
          <Icon t-else="" name="'locate-fixed'" size="18"/>
          <span class="hidden sm:inline">My location</span>
        </button>
      </div>

      <div class="flex items-start gap-2 rounded-input border border-line-light bg-paper-0 p-3 text-sm" aria-live="polite">
        <span class="mt-0.5 text-ink-400"><Icon name="'map-pin'" size="16"/></span>
        <span t-if="state.looking" class="text-ink-400">Finding the address…</span>
        <span t-elif="state.zoomTooLow or !state.hasPoint" class="text-ink-500">Move the map so the pin sits on the exact spot.</span>
        <span t-elif="state.suggested" class="text-ink-900" t-out="state.suggested"/>
        <span t-else="" class="text-ink-500">No street address found here. Describe the place below.</span>
      </div>
      <p t-if="state.locateError" role="alert" class="text-xs text-dispute" t-out="state.locateError"/>

      <TextAreaField t-if="props.showDetails !== false" id="props.id + '-details'" label="props.detailsLabel or 'Shop name, floor or landmark'" rows="2" maxlength="200"
        hint="props.detailsHint or 'Whatever gets a worker to the right door.'" value="state.details" onInput="setDetails"/>
    </div>`;
  static components = { Combobox, Icon, TextAreaField };
  static override props = {
    id: String,
    /** The current choice, or undefined for none yet. */
    value: { type: Object, optional: true },
    onChange: Function,
    tone: { type: String, optional: true },
    /** Where to open when there is no value yet, e.g. near the pickup when choosing a drop-off. */
    initialCentre: { type: Object, optional: true },
    searchLabel: { type: String, optional: true },
    searchPlaceholder: { type: String, optional: true },
    detailsLabel: { type: String, optional: true },
    detailsHint: { type: String, optional: true },
    /** Hide the free-text details field, e.g. for a worker's private base point. */
    showDetails: { type: Boolean, optional: true },
  };

  state = useState({
    query: '',
    results: [] as PlaceView[],
    resultsOpen: false,
    searching: false,
    activeResult: 0,
    mapReady: false,
    mapFailed: false,
    moving: false,
    zoomTooLow: true,
    hasPoint: false,
    looking: false,
    suggested: '',
    details: '',
    stateName: '',
    cityName: '',
    locating: false,
    locateError: '',
  });

  mapRef = useRef('map');
  searchClass = input(false, 'h-12 pl-10 text-[15px]');
  locateClass =
    'absolute bottom-3 left-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-paper-0 px-3 text-sm font-semibold text-ink-900 shadow-float ' +
    'transition-transform duration-micro ease-onsite active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900';

  stateOptions: ComboboxOption[] = INDIA_STATES.map((s) => ({ value: s.name, label: s.name, hint: `${s.cities.length} cities` }));

  private map: MapLibreMap | null = null;
  private point: { lat: number; lng: number } | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private reverseTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;
  private reverseSeq = 0;
  /** Set when the next settle is a move we made to a known address, so it is not looked up again. */
  private keepSuggestion = false;
  private disposed = false;

  override setup() {
    const initial = this.props.value as PickedLocation | null | undefined;
    if (initial) {
      this.state.suggested = initial.suggestedAddress;
      this.state.details = initial.details;
      this.point = { lat: initial.latitude, lng: initial.longitude };
      this.state.hasPoint = true;
      this.state.zoomTooLow = false;
    }

    onMounted(() => {
      void this.initMap(initial ?? null);
    });
    onWillUnmount(() => {
      this.disposed = true;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (this.reverseTimer) clearTimeout(this.reverseTimer);
      this.map?.remove();
      this.map = null;
    });
  }

  // ─── Derived ──────────────────────────────────────────────────────────

  get searchId(): string {
    return `${this.props.id}-search`;
  }

  get resultsId(): string {
    return `${this.props.id}-results`;
  }

  get activeResultId(): string | null {
    return this.state.resultsOpen && this.state.results.length > 0 ? this.resultId(this.state.activeResult) : null;
  }

  get cityOptions(): ComboboxOption[] {
    const found = INDIA_STATES.find((s) => s.name === this.state.stateName);
    return found ? found.cities.map((c) => ({ value: c.name, label: c.name })) : [];
  }

  get pinFill(): string {
    const tone = (this.props.tone as PinTone | undefined) ?? 'task';
    return tone === 'dropoff' ? '#141414' : tone === 'pickup' ? '#0c831f' : '#ffcb05';
  }

  get pinClass(): string {
    const lift = this.state.moving ? ' -translate-y-[calc(100%+8px)]' : ' -translate-y-full';
    return `pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 transition-transform duration-base ease-onsite${lift}`;
  }

  resultId(index: number): string {
    return `${this.props.id}-result-${index}`;
  }

  resultClass(index: number): string {
    const base = 'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-input px-3 py-2 text-sm text-ink-500';
    return index === this.state.activeResult ? `${base} bg-brand-50` : base;
  }

  // ─── Map ──────────────────────────────────────────────────────────────

  private async initMap(initial: PickedLocation | null) {
    const el = this.mapRef.el as HTMLElement | null;
    if (!el) return;
    const start = initial
      ? { center: [initial.longitude, initial.latitude] as [number, number], zoom: PLACE_ZOOM }
      : this.props.initialCentre
        ? {
            center: [(this.props.initialCentre as { lng: number }).lng, (this.props.initialCentre as { lat: number }).lat] as [number, number],
            zoom: MIN_PIN_ZOOM - 1,
          }
        : { center: [INDIA_CENTRE.lng, INDIA_CENTRE.lat] as [number, number], zoom: 4 };

    let map: MapLibreMap | null = null;
    try {
      map = await createMap(el, start);
    } catch {
      map = null;
    }
    if (this.disposed) {
      map?.remove();
      return;
    }
    if (!map) {
      this.state.mapFailed = true;
      return;
    }
    this.map = map;
    if (initial) this.keepSuggestion = true;
    map.on('load', () => {
      if (this.disposed) return;
      this.state.mapReady = true;
      // An existing point saved without an address (a worker's base): look it up once.
      if (this.point && !this.state.suggested) this.lookUpAddress();
    });
    map.on('movestart', () => {
      this.state.moving = true;
    });
    map.on('zoom', () => {
      const low = map.getZoom() < MIN_PIN_ZOOM;
      if (this.state.zoomTooLow !== low) this.state.zoomTooLow = low;
    });
    map.on('moveend', () => this.onSettled());
    this.state.zoomTooLow = map.getZoom() < MIN_PIN_ZOOM;
  }

  private onSettled() {
    const map = this.map;
    if (!map || this.disposed) return;
    this.state.moving = false;
    const zoomTooLow = map.getZoom() < MIN_PIN_ZOOM;
    this.state.zoomTooLow = zoomTooLow;
    if (zoomTooLow) {
      this.point = null;
      this.state.hasPoint = false;
      this.emit();
      return;
    }
    const centre = map.getCenter();
    this.point = { lat: round6(centre.lat), lng: round6(centre.lng) };
    this.state.hasPoint = true;
    if (this.keepSuggestion) {
      this.keepSuggestion = false;
      this.emit();
      return;
    }
    this.state.suggested = '';
    this.emit();
    this.lookUpAddress();
  }

  private flyTo(lat: number, lng: number, zoom: number) {
    if (this.map) {
      this.map.flyTo({ center: [lng, lat], zoom, essential: true, duration: 900 });
    } else {
      // No map on this device: the chosen place is the answer as it is.
      this.point = { lat: round6(lat), lng: round6(lng) };
      this.state.hasPoint = zoom >= MIN_PIN_ZOOM;
      this.state.zoomTooLow = zoom < MIN_PIN_ZOOM;
      this.emit();
    }
  }

  private lookUpAddress() {
    if (this.reverseTimer) clearTimeout(this.reverseTimer);
    const point = this.point;
    if (!point) return;
    this.state.looking = true;
    this.reverseTimer = setTimeout(async () => {
      const seq = ++this.reverseSeq;
      try {
        const res = await api.get<{ data: PlaceView | null }>(`/places/reverse?lat=${point.lat}&lng=${point.lng}`);
        if (this.disposed || seq !== this.reverseSeq) return;
        this.state.suggested = res.data?.address ?? '';
      } catch {
        if (!this.disposed && seq === this.reverseSeq) this.state.suggested = '';
      } finally {
        if (!this.disposed && seq === this.reverseSeq) {
          this.state.looking = false;
          this.emit();
        }
      }
    }, REVERSE_DEBOUNCE_MS);
  }

  private emit() {
    const point = this.point;
    this.props.onChange(
      point && !this.state.zoomTooLow
        ? { latitude: point.lat, longitude: point.lng, suggestedAddress: this.state.suggested, details: this.state.details }
        : null,
    );
  }

  // ─── Search ───────────────────────────────────────────────────────────

  onSearchFocus() {
    if (this.state.query.trim().length >= 2) this.state.resultsOpen = true;
  }

  onSearchFocusOut(ev: FocusEvent) {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next)) this.state.resultsOpen = false;
  }

  onSearchInput(ev: Event) {
    const query = (ev.target as HTMLInputElement).value;
    this.state.query = query;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (query.trim().length < 2) {
      this.state.resultsOpen = false;
      this.state.results = [];
      return;
    }
    this.state.resultsOpen = true;
    this.state.searching = true;
    this.searchTimer = setTimeout(() => void this.runSearch(query.trim()), SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(query: string) {
    const seq = ++this.searchSeq;
    const params = new URLSearchParams({ q: query });
    // Bias towards what the user is looking at, once they are looking at somewhere specific.
    if (this.map && this.map.getZoom() >= 9) {
      const c = this.map.getCenter();
      params.set('lat', String(round6(c.lat)));
      params.set('lng', String(round6(c.lng)));
    }
    try {
      const res = await api.get<{ data: PlaceView[] }>(`/places/search?${params.toString()}`);
      if (this.disposed || seq !== this.searchSeq) return;
      this.state.results = res.data;
      this.state.activeResult = 0;
    } catch {
      if (!this.disposed && seq === this.searchSeq) this.state.results = [];
    } finally {
      if (!this.disposed && seq === this.searchSeq) this.state.searching = false;
    }
  }

  onSearchKeydown(ev: KeyboardEvent) {
    const count = this.state.results.length;
    if (ev.key === 'ArrowDown' && count > 0) {
      ev.preventDefault();
      this.state.resultsOpen = true;
      this.state.activeResult = (this.state.activeResult + 1) % count;
    } else if (ev.key === 'ArrowUp' && count > 0) {
      ev.preventDefault();
      this.state.activeResult = (this.state.activeResult - 1 + count) % count;
    } else if (ev.key === 'Enter') {
      const place = this.state.results[this.state.activeResult];
      if (this.state.resultsOpen && place) {
        ev.preventDefault();
        this.choosePlace(place);
      }
    } else if (ev.key === 'Escape') {
      this.state.resultsOpen = false;
    }
  }

  choosePlace = (place: PlaceView) => {
    this.state.query = place.name;
    this.state.resultsOpen = false;
    this.state.suggested = place.address;
    this.state.locateError = '';
    this.keepSuggestion = true;
    this.flyTo(place.latitude, place.longitude, PLACE_ZOOM);
  };

  // ─── State / city, device location, details ───────────────────────────

  selectState = (name: string) => {
    if (this.state.stateName === name) return;
    this.state.stateName = name;
    this.state.cityName = '';
  };

  selectCity = (name: string) => {
    this.state.cityName = name;
    const city = INDIA_STATES.find((s) => s.name === this.state.stateName)?.cities.find((c) => c.name === name);
    if (city) this.flyTo(city.lat, city.lng, CITY_ZOOM);
  };

  useMyLocation = async () => {
    this.state.locating = true;
    this.state.locateError = '';
    const position = await getPosition();
    if (this.disposed) return;
    this.state.locating = false;
    if (!position) {
      this.state.locateError = 'Could not read your location. Allow location access, or search for the place instead.';
      return;
    }
    this.flyTo(position.coords.latitude, position.coords.longitude, PLACE_ZOOM);
  };

  setDetails = (value: string) => {
    this.state.details = value;
    this.emit();
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
