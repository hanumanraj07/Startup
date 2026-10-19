import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { formatDistance } from '@onsite/utils';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { onSessionEvent, onSessionReconnect } from '@/services/socket';
import { store, toast } from '@/store/store';
import { btn } from '@/ui/classes';
import { CategoryBadge } from './CategoryBadge';
import { Icon } from './Icon';

/** GET /offers/mine and the `offer:new` event. Locality only, as in the feed. */
export interface OfferView {
  offerId: string;
  taskId: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  payoutPaise: number;
  /** Money the worker would front for an item and get back, or 0. Not earnings. */
  itemBudgetPaise: number;
  distanceMeters: number;
  approximateAddress: string;
  dropoff: { approximateAddress: string; tripDistanceMeters: number } | null;
  deadlineAt: string;
  expiresAt: string;
  windowSeconds: number;
  requester: { displayName: string; verificationLevel: number };
}

type Closed = 'TAKEN' | 'EXPIRED' | 'WITHDRAWN' | null;

const RING = 2 * Math.PI * 26;
const CLOSED_NOTICE_MS = 2_500;

/**
 * The ride-app style incoming request: a sheet over whatever the worker is
 * doing, with the payout up front and a ring counting down the response
 * window. Several workers get the same request; the API decides who wins, so
 * Accept can still be told "someone was faster", which is shown plainly and
 * then the sheet moves on. Requests arrive live over the session socket and
 * are re-read from GET /offers/mine on open and on every reconnect, so one
 * sent while the screen was off still appears with its remaining time.
 */
export class IncomingRequest extends Component {
  static override template = xml`
    <div t-if="current" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <section role="alertdialog" aria-modal="true" aria-labelledby="incoming-title" aria-describedby="incoming-summary"
        class="page-enter w-full max-w-md rounded-t-sheet bg-paper-0 p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-float sm:rounded-sheet sm:pb-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">New task request</p>
            <h2 id="incoming-title" class="mt-1 text-xl font-bold leading-snug text-ink-900" t-out="current.title"/>
          </div>
          <div class="relative h-16 w-16 shrink-0" t-att-aria-label="secondsLeft + ' seconds left to respond'" role="timer">
            <svg viewBox="0 0 60 60" class="h-16 w-16 -rotate-90" aria-hidden="true">
              <circle cx="30" cy="30" r="26" fill="none" stroke="var(--paper-100)" stroke-width="6"/>
              <circle cx="30" cy="30" r="26" fill="none" t-att-stroke="ringColour" stroke-width="6" stroke-linecap="round"
                t-att-stroke-dasharray="ring" t-att-stroke-dashoffset="ringOffset"/>
            </svg>
            <span class="tabular absolute inset-0 flex items-center justify-center text-lg font-extrabold text-ink-900" t-out="secondsLeft"/>
          </div>
        </div>

        <div id="incoming-summary" class="mt-4 flex items-center gap-3">
          <CategoryBadge slug="current.categorySlug" size="44"/>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-ink-500" t-out="current.categoryName"/>
            <p class="tabular text-3xl font-extrabold text-verified" t-out="payout"/>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2 text-sm text-ink-700">
          <span class="tabular inline-flex items-center gap-1 rounded-full bg-paper-100 px-2.5 py-1 font-semibold">
            <Icon name="'navigation'" size="14"/> <t t-out="distance"/> away
          </span>
          <span class="tabular inline-flex items-center gap-1 rounded-full bg-paper-100 px-2.5 py-1">
            <Icon name="'clock'" size="14"/> Due in <t t-out="dueIn"/>
          </span>
          <span class="inline-flex min-w-0 items-center gap-1 text-ink-500">
            <Icon name="'map-pin'" size="14"/> <span class="truncate" t-out="current.approximateAddress"/>
          </span>
        </div>
        <p t-if="current.dropoff" class="mt-2 flex items-center gap-2 rounded-input bg-paper-50 px-3 py-2 text-sm text-ink-700">
          <Icon name="'package'" size="14"/>
          <span>Deliver <span class="tabular font-semibold" t-out="trip"/> to <t t-out="current.dropoff.approximateAddress"/></span>
        </p>
        <p t-if="current.itemBudgetPaise > 0" class="mt-2 flex items-center gap-2 rounded-input bg-tint-orange px-3 py-2 text-sm text-[#7a3d00]">
          <Icon name="'shopping-bag'" size="14" class="'shrink-0'"/>
          <span class="min-w-0">Buy an item, up to <span class="tabular font-semibold" t-out="itemBudget"/>. You pay first and get it back.</span>
        </p>
        <p class="mt-3 flex items-center gap-1.5 text-sm text-ink-500">
          <Icon name="'shield-check'" size="14"/> <t t-out="current.requester.displayName"/> · level <t t-out="current.requester.verificationLevel"/>
        </p>

        <p t-if="state.closed" role="status" class="mt-4 rounded-input bg-paper-100 px-3 py-2 text-sm font-semibold text-ink-900" t-out="closedText"/>
        <p t-elif="state.error" role="alert" class="mt-4 text-sm text-dispute" t-out="state.error"/>

        <div class="mt-5 grid grid-cols-[1fr_2fr] gap-3">
          <button type="button" t-att-class="declineClass" t-att-disabled="state.busy or state.closed" t-on-click="decline">Decline</button>
          <button type="button" t-att-class="acceptClass" t-att-disabled="state.busy or state.closed" t-on-click="accept">
            <span t-if="state.busy" class="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden="true"/>
            Accept
          </button>
        </div>
        <p t-if="state.queue.length > 1" class="mt-3 text-center text-xs text-ink-400">
          <t t-out="state.queue.length - 1"/> more waiting
        </p>
      </section>
    </div>`;
  static components = { CategoryBadge, Icon };
  static override props = {};

  store = useState(store);
  state = useState({
    queue: [] as OfferView[],
    now: Date.now(),
    busy: false,
    error: '',
    closed: null as Closed,
  });

  ring = RING;
  declineClass = btn('secondary', 'lg', 'w-full');
  acceptClass = btn('primary', 'lg', 'w-full text-base');

  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
      this.unsubscribers.push(
        onSessionEvent('offer:new', (payload) => this.add(payload as OfferView)),
        onSessionEvent('offer:closed', (payload) => this.onClosed(payload as { offerId: string; reason: Closed })),
        onSessionEvent('task:assigned', (payload) => this.onAssigned(payload as { taskId: string; taskTitle: string; workerName: string })),
        onSessionReconnect(() => void this.load()),
      );
      this.timer = setInterval(() => this.tick(), 250);
    });
    onWillUnmount(() => {
      this.disposed = true;
      this.unsubscribers.forEach((fn) => fn());
      if (this.timer) clearInterval(this.timer);
    });
  }

  get current(): OfferView | undefined {
    return this.state.queue[0];
  }

  get remainingMs(): number {
    return this.current ? Math.max(0, Date.parse(this.current.expiresAt) - this.state.now) : 0;
  }

  get secondsLeft(): number {
    return Math.ceil(this.remainingMs / 1000);
  }

  /** The ring empties over the response window (90 s by default; whatever the server set). */
  get ringOffset(): number {
    const offer = this.current;
    if (!offer) return RING;
    const total = Math.max(1, offer.windowSeconds * 1000);
    return RING * (1 - Math.min(1, this.remainingMs / total));
  }

  get ringColour(): string {
    return this.secondsLeft <= 15 ? 'var(--dispute)' : 'var(--accent-600)';
  }

  get payout(): string {
    return this.current ? formatPaise(this.current.payoutPaise) : '';
  }

  get distance(): string {
    return this.current ? formatDistance(this.current.distanceMeters) : '';
  }

  get itemBudget(): string {
    return this.current ? formatPaise(this.current.itemBudgetPaise ?? 0) : '';
  }

  get trip(): string {
    return this.current?.dropoff ? formatDistance(this.current.dropoff.tripDistanceMeters) : '';
  }

  get dueIn(): string {
    if (!this.current) return '';
    const minutes = Math.max(0, Math.round((Date.parse(this.current.deadlineAt) - this.state.now) / 60_000));
    return minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
  }

  get closedText(): string {
    if (this.state.closed === 'TAKEN') return 'Another worker accepted this one first.';
    if (this.state.closed === 'EXPIRED') return 'Time is up for this request. If it is still open, it stays in your feed.';
    return 'This request is no longer available.';
  }

  private async load() {
    if (!this.store.user?.hasWorkerProfile) return;
    try {
      const res = await api.get<{ data: OfferView[] }>('/offers/mine');
      if (this.disposed) return;
      for (const offer of res.data) this.add(offer, false);
    } catch {
      // The socket path still works; this is the catch-up read.
    }
  }

  private add(offer: OfferView, announce = true) {
    if (Date.parse(offer.expiresAt) <= Date.now() || Date.parse(offer.deadlineAt) <= Date.now()) return;
    if (this.state.queue.some((o) => o.offerId === offer.offerId)) return;
    this.state.queue = [...this.state.queue, offer];
    if (announce && this.state.queue.length === 1) navigator.vibrate?.([200, 100, 200]);
  }

  private onClosed(event: { offerId: string; reason: Closed }) {
    if (this.current?.offerId === event.offerId) this.showClosed(event.reason ?? 'WITHDRAWN');
    else this.state.queue = this.state.queue.filter((o) => o.offerId !== event.offerId);
  }

  private onAssigned(event: { taskId: string; taskTitle: string; workerName: string }) {
    toast(`${event.workerName} accepted your task`, { description: event.taskTitle, variant: 'success' });
  }

  private tick() {
    this.state.now = Date.now();
    if (this.current && !this.state.closed && this.remainingMs <= 0) this.showClosed('EXPIRED');
  }

  private showClosed(reason: Closed) {
    this.state.closed = reason;
    setTimeout(() => this.next(), CLOSED_NOTICE_MS);
  }

  private next() {
    if (this.disposed) return;
    this.state.queue = this.state.queue.slice(1);
    this.state.closed = null;
    this.state.error = '';
  }

  accept = async () => {
    const offer = this.current;
    if (!offer) return;
    this.state.busy = true;
    this.state.error = '';
    try {
      await api.post(`/tasks/${offer.taskId}/accept`);
      this.state.queue = this.state.queue.filter((o) => o.offerId !== offer.offerId);
      toast('Task accepted', { description: 'Tap “On my way” when you set off.', variant: 'success' });
      navigate(`/tasks/${offer.taskId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) this.showClosed('TAKEN');
      else this.state.error = err instanceof ApiError ? err.message : 'Could not accept. Try again.';
    } finally {
      this.state.busy = false;
    }
  };

  decline = async () => {
    const offer = this.current;
    if (!offer) return;
    this.state.busy = true;
    try {
      await api.post(`/tasks/${offer.taskId}/decline`, { reason: 'UNAVAILABLE' });
    } catch {
      // Declining is a courtesy signal; failing to record it must not trap the worker on this sheet.
    } finally {
      this.state.busy = false;
      this.next();
    }
  };
}
