/**
 * The worker's side of live tracking: watches the device position while the
 * trip is on and sends it, throttled, over the task's socket. Foreground only
 * (a web app cannot track in the background, and that is the honest limit
 * the screen states). Sending is gated on the task status by the caller and
 * re-checked by the API on every update.
 *
 * Battery and data: positions are sent at most every SEND_INTERVAL_MS, or
 * sooner once the worker has moved SEND_DISTANCE_M — the distance here only
 * decides whether to send, it is never shown or trusted. While the socket is
 * down the newest point is kept, and sent as soon as it reconnects.
 */

export type SharingStatus = 'idle' | 'starting' | 'sharing' | 'denied' | 'unavailable' | 'offline';

export interface SharingState {
  status: SharingStatus;
  lastSentAt: number | null;
}

interface Position {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  heading?: number;
  speed?: number;
}

const SEND_INTERVAL_MS = 5_000;
const SEND_DISTANCE_M = 20;

export class LocationSharer {
  private watchId: number | null = null;
  private latest: Position | null = null;
  private lastSent: { at: number; position: Position } | null = null;
  private state: SharingState = { status: 'idle', lastSentAt: null };

  constructor(
    private readonly send: (position: Position) => void,
    private readonly isConnected: () => boolean,
    private readonly onState: (state: SharingState) => void,
  ) {}

  start(): void {
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.setState({ status: 'unavailable' });
      return;
    }
    this.setState({ status: 'starting' });
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (error) => this.setState({ status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.latest = null;
    this.setState({ status: 'idle' });
  }

  /** The socket came back: send the newest point at once. */
  flush(): void {
    if (this.latest) this.trySend(this.latest, true);
  }

  private onPosition(pos: GeolocationPosition) {
    const position: Position = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracyMeters: pos.coords.accuracy,
      ...(pos.coords.heading !== null && Number.isFinite(pos.coords.heading) && { heading: pos.coords.heading }),
      ...(pos.coords.speed !== null && Number.isFinite(pos.coords.speed) && { speed: pos.coords.speed }),
    };
    this.latest = position;
    this.trySend(position, false);
  }

  private trySend(position: Position, force: boolean) {
    if (!this.isConnected()) {
      this.setState({ status: 'offline' });
      return;
    }
    const now = Date.now();
    const last = this.lastSent;
    const due = force || !last || now - last.at >= SEND_INTERVAL_MS || roughMeters(last.position, position) >= SEND_DISTANCE_M;
    if (!due) {
      if (this.state.status !== 'sharing') this.setState({ status: 'sharing' });
      return;
    }
    this.send(position);
    this.lastSent = { at: now, position };
    this.setState({ status: 'sharing', lastSentAt: now });
  }

  private setState(patch: Partial<SharingState>) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }
}

/** Equirectangular approximation, plenty for "moved about 20 m?". Throttling only. */
function roughMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad);
  const y = (b.latitude - a.latitude) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
