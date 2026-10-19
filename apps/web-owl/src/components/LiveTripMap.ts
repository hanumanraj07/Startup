import { Component, onMounted, onWillUnmount, useEffect, useRef, useState, xml } from '@odoo/owl';
import { formatDistance } from '@onsite/utils';
import { createMap, loadMapLibre, type MapLibreMap } from '@/services/map';
import type { LiveLocationEvent } from '@/services/socket';

type MarkerInstance = InstanceType<Awaited<ReturnType<typeof loadMapLibre>>['Marker']>;

/** After this long without an update, say so rather than show a frozen dot as if it were live. */
const STALE_MS = 45_000;

/**
 * The live trip: where the worker is heading and where they are now, the
 * marker gliding as updates arrive over the task's socket. The distance shown
 * is the server's (PostGIS); this never measures anything itself. Shown only
 * while sharing is on (lib/task-progress.ts isTracking), to the requester and
 * the assigned worker.
 */
export class LiveTripMap extends Component {
  static override template = xml`
    <div class="overflow-hidden rounded-card border border-line-light bg-paper-0 shadow-card">
      <div class="relative h-[260px] bg-paper-100 sm:h-[300px]">
        <div class="absolute inset-0"><div t-ref="map" class="h-full w-full" role="img" t-att-aria-label="ariaLabel"/></div>
        <div t-if="!state.ready and !state.failed" class="skeleton absolute inset-0" aria-hidden="true"/>
        <p t-if="state.failed" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-500">
          The map can’t be shown on this device.
        </p>
        <span class="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink-900/85 px-3 py-1 text-xs font-semibold text-white">
          <span t-att-class="liveDotClass" aria-hidden="true"/> <t t-out="badge"/>
        </span>
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3" aria-live="polite">
        <p class="text-sm text-ink-900" t-out="headline"/>
        <p class="tabular shrink-0 text-xs text-ink-400" t-out="freshness"/>
      </div>
    </div>`;
  static override props = {
    destination: Object,
    /** "the pickup", "the drop-off", "the task location". */
    destinationLabel: String,
    location: { type: Object, optional: true },
    viewer: String,
    workerName: { type: String, optional: true },
  };

  state = useState({ ready: false, failed: false, now: Date.now() });
  mapRef = useRef('map');
  private map: MapLibreMap | null = null;
  private workerMarker: MarkerInstance | null = null;
  private fitted = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.init();
      this.timer = setInterval(() => {
        this.state.now = Date.now();
      }, 5_000);
    });
    onWillUnmount(() => {
      this.disposed = true;
      if (this.timer) clearInterval(this.timer);
      this.map?.remove();
      this.map = null;
    });
    useEffect(
      () => {
        this.placeWorker();
      },
      () => [this.props.location, this.state.ready],
    );
  }

  get location(): LiveLocationEvent | undefined {
    return this.props.location as LiveLocationEvent | undefined;
  }

  get stale(): boolean {
    const at = this.location ? Date.parse(this.location.at) : NaN;
    return !Number.isFinite(at) || this.state.now - at > STALE_MS;
  }

  get badge(): string {
    if (!this.location) return 'Waiting for location';
    return this.stale ? 'Signal weak' : 'Live';
  }

  get liveDotClass(): string {
    return `h-2 w-2 rounded-full ${this.location && !this.stale ? 'bg-accent-500' : 'bg-ink-400'}`;
  }

  get headline(): string {
    const loc = this.location;
    const to = this.props.destinationLabel;
    if (!loc) {
      return this.props.viewer === 'worker'
        ? 'Finding your position…'
        : `${this.props.workerName ?? 'The worker'} has set off. Their position appears here once their phone shares it.`;
    }
    const distance = formatDistance(loc.distanceMeters);
    return this.props.viewer === 'worker'
      ? `You are ${distance} from ${to}.`
      : `${this.props.workerName ?? 'The worker'} is ${distance} from ${to}.`;
  }

  get freshness(): string {
    if (!this.location) return '';
    const seconds = Math.max(0, Math.round((this.state.now - Date.parse(this.location.at)) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)} min ago`;
  }

  get ariaLabel(): string {
    return `Map of the trip to ${this.props.destinationLabel}`;
  }

  private async init() {
    const el = this.mapRef.el as HTMLElement | null;
    if (!el) return;
    const dest = this.props.destination as { latitude: number; longitude: number };
    let map: MapLibreMap | null = null;
    try {
      map = await createMap(el, { center: [dest.longitude, dest.latitude], zoom: 14, interactive: true });
    } catch {
      map = null;
    }
    if (this.disposed) {
      map?.remove();
      return;
    }
    if (!map) {
      this.state.failed = true;
      return;
    }
    this.map = map;
    const maplibre = await loadMapLibre();
    new maplibre.Marker({ element: markerEl('destination') }).setLngLat([dest.longitude, dest.latitude]).addTo(map);
    map.on('load', () => {
      if (!this.disposed) this.state.ready = true;
    });
  }

  private async placeWorker() {
    const map = this.map;
    const loc = this.location;
    if (!map || !loc || !this.state.ready) return;
    const maplibre = await loadMapLibre();
    if (!this.workerMarker) {
      this.workerMarker = new maplibre.Marker({ element: markerEl('worker') }).setLngLat([loc.longitude, loc.latitude]).addTo(map);
    } else {
      this.workerMarker.setLngLat([loc.longitude, loc.latitude]);
    }
    const dest = this.props.destination as { latitude: number; longitude: number };
    if (!this.fitted) {
      this.fitted = true;
      const bounds = new maplibre.LngLatBounds([dest.longitude, dest.latitude], [dest.longitude, dest.latitude]).extend([
        loc.longitude,
        loc.latitude,
      ]);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 600 });
    } else if (!map.getBounds().contains([loc.longitude, loc.latitude])) {
      map.easeTo({ center: [loc.longitude, loc.latitude], duration: 600 });
    }
  }
}

/** Plain DOM markers: the worker as a pulsing dot, the destination as the app's pin. */
function markerEl(kind: 'worker' | 'destination'): HTMLElement {
  const el = document.createElement('div');
  if (kind === 'worker') {
    el.className = 'live-worker-marker';
    el.innerHTML = '<span class="live-worker-pulse"></span><span class="live-worker-dot"></span>';
  } else {
    el.innerHTML =
      '<svg width="30" height="38" viewBox="0 0 36 46" fill="none" aria-hidden="true"><path d="M18 45C18 45 34 28.5 34 17A16 16 0 0 0 2 17C2 28.5 18 45 18 45Z" fill="#141414" stroke="#fff" stroke-width="2"/><circle cx="18" cy="17" r="6" fill="#ffcb05"/></svg>';
    el.style.transform = 'translateY(-50%)';
  }
  return el;
}
