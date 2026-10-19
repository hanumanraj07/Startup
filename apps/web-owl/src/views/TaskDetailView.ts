import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { formatDistance } from '@onsite/utils';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { LiveTripMap } from '@/components/LiveTripMap';
import { MoneyBreakdown, WorkerEarnings } from '@/components/MoneyBreakdown';
import { Page, type Crumb } from '@/components/Page';
import { ProgressSteps } from '@/components/ProgressSteps';
import { StatusPill } from '@/components/StatusPill';
import { Tabs } from '@/components/Tabs';
import { useTaskSocket } from '@/hooks/use-task-socket';
import {
  isOwnerView,
  type ItemBill,
  type OwnerTask,
  type ProofView,
  type TaskDetail,
  type WorkerTask,
} from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { buildProgress, isTracking, type ProgressStep } from '@/lib/task-progress';
import {
  CHAT_VISIBLE_STATUSES,
  CHAT_WRITABLE_STATUSES,
  LEAVABLE_STATUSES,
  PROOF_VISIBLE_STATUSES,
  REPORTABLE_STATUSES,
  WORKER_REMOVABLE_STATUSES,
} from '@/lib/task-status';
import { navigate, routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { LocationSharer, type SharingState } from '@/services/location-sharer';
import type { LiveLocationEvent } from '@/services/socket';
import { toast } from '@/store/store';
import { card, CARD_CONTENT } from '@/ui/classes';
import { ChatPanel } from './task/ChatPanel';
import { ItemBillPanel } from './task/ItemBillPanel';
import { ReleaseAssignmentDialog } from './task/ReleaseAssignmentDialog';
import { ReportIssueDialog } from './task/ReportIssueDialog';
import { RequesterActions } from './task/RequesterActions';
import { WorkerActions } from './task/WorkerActions';

const BAR = 'skeleton rounded-md';

type Tab = 'progress' | 'details' | 'payment' | 'chat';

const WIDE = '(min-width: 1024px)';

/**
 * One task, for whichever party is looking. At the top: where it is and what
 * happens next (a "Now" card with the viewer's next action), and the live trip
 * map while the worker's location is being shared. Below: tabs for the step-by-
 * step progress, the details, the payment, and the chat (the chat moves to a
 * side column on wide screens). Status changes, chat and live location arrive
 * over the task's socket room, so nothing needs a manual refresh. Every rule
 * about what is allowed still comes from the API; this only shows it.
 */
export class TaskDetailView extends Component {
  static override template = xml`
    <Page breadcrumbs="breadcrumbs" heading="false">
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>

      <div t-elif="!state.task" class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" aria-hidden="true">
        <div class="flex flex-col gap-4">
          <div t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex flex-col gap-3">
              <div class="h-5 w-24 ${BAR}"/><div class="h-8 w-3/4 ${BAR}"/><div class="h-4 w-1/2 ${BAR}"/>
            </div>
          </div>
          <div class="h-28 w-full ${BAR} rounded-card"/>
          <div class="h-40 w-full ${BAR} rounded-card"/>
        </div>
      </div>

      <div t-else="" class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="flex min-w-0 flex-col gap-4">
          <!-- Header: what and where. -->
          <div t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <StatusPill status="task.status"/>
                <span class="text-sm text-ink-400" t-out="task.categoryName"/>
              </div>
              <h1 class="text-2xl font-bold tracking-tight text-ink-900" t-out="task.title"/>
              <div t-if="task.dropoff" class="flex flex-col rounded-input border border-line-light p-1" role="group" aria-label="Route">
                <div class="flex items-start gap-3 p-2">
                  <span class="relative flex w-4 shrink-0 justify-center self-stretch" aria-hidden="true">
                    <span class="mt-1 h-2.5 w-2.5 rounded-full bg-accent-600 ring-4 ring-tint-green"/>
                    <span class="absolute bottom-[-12px] top-5 border-l-2 border-dashed border-ink-300"/>
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">Pickup</p>
                    <p class="text-sm text-ink-900" t-out="task.location.address"/>
                  </div>
                  <a t-if="workerTask" t-att-href="directionsUrl(task.location)" target="_blank" rel="noreferrer" t-att-class="directionsClass">Directions</a>
                </div>
                <div class="flex items-start gap-3 p-2">
                  <span class="flex w-4 shrink-0 justify-center" aria-hidden="true"><span class="mt-1 h-2.5 w-2.5 rounded-[3px] bg-ink-900 ring-4 ring-paper-100"/></span>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">Drop-off</p>
                    <p class="text-sm text-ink-900" t-out="task.dropoff.address"/>
                  </div>
                  <a t-if="workerTask" t-att-href="directionsUrl(task.dropoff)" target="_blank" rel="noreferrer" t-att-class="directionsClass">Directions</a>
                </div>
              </div>
              <p t-else="" class="flex items-center gap-1.5 text-sm text-ink-500">
                <Icon name="'map-pin'" size="16"/> <span class="min-w-0" t-out="task.location.address"/>
                <a t-if="workerTask" t-att-href="directionsUrl(task.location)" target="_blank" rel="noreferrer" t-att-class="directionsClass + ' ml-auto'">Directions</a>
              </p>
            </div>
          </div>

          <!-- Now: the current step, and what this viewer can do about it. -->
          <section t-att-class="nowClass" aria-labelledby="now-title">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-brand-solid" aria-hidden="true">
                <Icon name="nowIcon" size="18"/>
              </span>
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Now</p>
                <h2 id="now-title" class="text-lg font-bold text-ink-900" t-out="now.title"/>
                <p class="mt-0.5 text-sm text-ink-700" t-out="now.detail"/>
              </div>
            </div>

            <div t-if="workerTask and tracking" t-att-class="sharingClass" role="status">
              <span t-att-class="sharingDotClass" aria-hidden="true"/>
              <span t-out="sharingText"/>
            </div>
          </section>

          <LiveTripMap t-if="tracking" t-key="liveKey" destination="destination" destinationLabel="destinationLabel"
            location="state.live or undefined" viewer="workerTask ? 'worker' : 'requester'" workerName="workerName"/>

          <ItemBillPanel t-if="hasItem"
            taskId="task.id" role="workerTask ? 'worker' : 'requester'" status="task.status" bills="state.bills"
            onChanged="load" item="workerTask ? (workerTask.item or undefined) : undefined"
            handover="ownerTask ? (ownerTask.handover or undefined) : undefined"/>

          <WorkerActions t-if="workerTask"
            taskId="task.id" status="task.status" proofRequirements="task.proofRequirements"
            proofs="state.proofs" onChanged="load" locationMode="task.locationMode" item="workerTask.item or undefined"/>
          <RequesterActions t-if="ownerTask"
            taskId="task.id" status="task.status" proofs="state.proofs" onChanged="load"/>

          <Tabs tabs="tabs" value="state.tab" onChange="setTab"/>

          <div t-if="state.tab === 'progress'" t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex flex-col gap-5">
              <ProgressSteps steps="progress.steps" offPath="progress.offPath or undefined"/>
              <div t-if="notes.length" class="border-t border-line-light pt-4">
                <h3 class="mb-2 text-sm font-semibold text-ink-900">Updates</h3>
                <ul class="flex flex-col gap-2">
                  <li t-foreach="notes" t-as="note" t-key="note_index" class="text-sm text-ink-700">
                    <span class="tabular text-xs text-ink-400" t-out="when(note)"/> · <t t-out="note.reason"/>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div t-elif="state.tab === 'details'" class="flex flex-col gap-4">
            <div t-att-class="cardClass">
              <div class="${CARD_CONTENT} flex flex-col gap-4">
                <div>
                  <h3 class="text-sm font-semibold text-ink-900">Instructions</h3>
                  <p class="mt-1 whitespace-pre-wrap text-[15px] text-ink-700" t-out="task.description"/>
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-ink-900">Proof required</h3>
                  <ul class="mt-1 flex flex-col gap-1">
                    <li t-foreach="task.proofRequirements" t-as="req" t-key="req_index" class="flex items-center gap-2 text-sm text-ink-700">
                      <Icon name="'circle-check'" size="14"/> <t t-out="req.label"/>
                      <span t-if="!req.required" class="text-xs text-ink-400">(optional)</span>
                    </li>
                  </ul>
                </div>
                <p class="tabular text-sm text-ink-500">Due <t t-out="deadline"/></p>
              </div>
            </div>

            <Link t-if="ownerTask and ownerTask.assignedWorker" to="'/profile/' + ownerTask.assignedWorker.id" class="'block'">
              <div t-att-class="cardClass + ' transition-colors duration-micro ease-onsite hover:bg-paper-100'">
                <div class="${CARD_CONTENT} flex items-center justify-between">
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">Your worker</p>
                    <p class="font-semibold text-ink-900" t-out="ownerTask.assignedWorker.displayName"/>
                    <p class="text-sm text-ink-500"><t t-out="ownerTask.assignedWorker.tasksCompleted"/> tasks completed</p>
                  </div>
                  <span t-if="rating" class="tabular text-sm font-semibold text-ink-900"><t t-out="rating"/> ★</span>
                </div>
              </div>
            </Link>
            <div t-if="workerTask" t-att-class="cardClass">
              <div class="${CARD_CONTENT}">
                <p class="text-xs font-semibold uppercase tracking-wide text-ink-400">Posted by</p>
                <p class="font-semibold text-ink-900" t-out="workerTask.requester.displayName"/>
                <p class="text-sm text-ink-500">Verification level <t t-out="workerTask.requester.verificationLevel"/></p>
              </div>
            </div>

            <div t-if="reportable or canLeave or canRemoveWorker" class="flex flex-wrap items-center gap-2">
              <ReportIssueDialog t-if="reportable" taskId="task.id" onReported="load"/>
              <ReleaseAssignmentDialog t-if="canLeave" taskId="task.id" mode="'leave'" onDone="onLeft"/>
              <ReleaseAssignmentDialog t-if="canRemoveWorker" taskId="task.id" mode="'remove'"
                workerName="ownerTask.assignedWorker.displayName" onDone="onWorkerRemoved"/>
            </div>
          </div>

          <div t-elif="state.tab === 'payment'" class="flex flex-col gap-3">
            <MoneyBreakdown t-if="ownerTask" money="ownerTask.money" paid="isPaid"/>
            <WorkerEarnings t-if="workerTask" payoutPaise="workerTask.payoutPaise" item="workerTask.item or undefined"/>
            <p class="rounded-input border border-line-light bg-paper-0 px-4 py-3 text-sm text-ink-700" t-out="paymentStatus"/>
          </div>

          <div t-elif="state.tab === 'chat' and !state.wide">
            <ChatPanel t-if="chatVisible" taskId="task.id" closed="!chatWritable"/>
            <p t-else="" class="rounded-card border border-line-light bg-paper-0 p-4 text-sm text-ink-500">
              Chat opens once a worker is assigned.
            </p>
          </div>
        </div>

        <aside t-if="state.wide" class="flex flex-col gap-4">
          <ChatPanel t-if="chatVisible" taskId="task.id" closed="!chatWritable"/>
          <div t-else="" class="rounded-card border border-line-light bg-paper-0 p-4 text-sm text-ink-500">
            Chat opens once a worker is assigned.
          </div>
        </aside>
      </div>
    </Page>`;
  static components = {
    ChatPanel,
    Icon,
    ItemBillPanel,
    Link,
    LiveTripMap,
    MoneyBreakdown,
    WorkerEarnings,
    Page,
    ProgressSteps,
    ReleaseAssignmentDialog,
    ReportIssueDialog,
    RequesterActions,
    StatusPill,
    Tabs,
    WorkerActions,
  };
  static override props = {};

  state = useState<{
    task: TaskDetail | null;
    proofs: ProofView[];
    /** Item bills (P6), newest first; empty when nothing is bought or no worker is assigned yet. */
    bills: ItemBill[];
    error: string | null;
    tab: Tab;
    wide: boolean;
    live: LiveLocationEvent | null;
    sharing: SharingState;
  }>({
    task: null,
    proofs: [],
    bills: [],
    error: null,
    tab: 'progress',
    wide: typeof window !== 'undefined' && window.matchMedia(WIDE).matches,
    live: null,
    sharing: { status: 'idle', lastSentAt: null },
  });

  cardClass = card();
  directionsClass = 'shrink-0 rounded-full bg-paper-100 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-line';

  private readonly taskId = routerState.params['id'] ?? '';
  private room: ReturnType<typeof useTaskSocket> | null = null;
  private sharer: LocationSharer | null = null;
  private media: MediaQueryList | null = null;

  override setup() {
    onMounted(() => {
      this.load().catch((err) => {
        this.state.error = err instanceof ApiError ? err.message : 'Could not load this task.';
      });
      this.media = window.matchMedia(WIDE);
      this.media.addEventListener('change', this.onMedia);
    });
    onWillUnmount(() => {
      this.sharer?.stop();
      this.media?.removeEventListener('change', this.onMedia);
    });

    if (this.taskId) {
      this.room = useTaskSocket(this.taskId, {
        // A status change from the other party arrives here instead of needing a refresh.
        onStatus: () => {
          this.load().catch((err) => {
            // The worker's view of a task disappears once they are released
            // from it (removed by the requester, or left on another device).
            if (err instanceof ApiError && err.status === 404 && this.workerTask) {
              this.sharer?.stop();
              this.state.task = null;
              this.state.error = 'You are no longer assigned to this task. It has gone back to other workers.';
            }
          });
        },
        onLocation: (event) => {
          this.state.live = event;
        },
        onLocationEnded: () => {
          this.state.live = null;
        },
        onConnection: (connected) => {
          if (connected) this.sharer?.flush();
        },
      });
    }
  }

  private onMedia = (ev: MediaQueryListEvent) => {
    this.state.wide = ev.matches;
    if (ev.matches && this.state.tab === 'chat') this.state.tab = 'progress';
  };

  // ─── Derived ────────────────────────────────────────────────────────────

  /** The loaded task; the template only reads it in the branch where it is present. */
  get task(): TaskDetail | null {
    return this.state.task;
  }

  get ownerTask(): OwnerTask | null {
    const task = this.state.task;
    return task && isOwnerView(task) ? task : null;
  }

  /** A task with an item to buy and a worker on it: the bill panel shows. */
  get hasItem(): boolean {
    const owner = this.ownerTask;
    if (owner) return owner.money.itemBudgetPaise > 0 && owner.assignedWorker !== null;
    return Boolean(this.workerTask?.item);
  }

  get workerTask(): WorkerTask | null {
    const task = this.state.task;
    return task && !isOwnerView(task) ? task : null;
  }

  get breadcrumbs(): Crumb[] {
    return [{ label: 'My tasks', to: '/tasks' }, { label: this.state.task?.title ?? 'Task' }];
  }

  get tabs(): { value: Tab; label: string }[] {
    const tabs: { value: Tab; label: string }[] = [
      { value: 'progress', label: 'Progress' },
      { value: 'details', label: 'Details' },
      { value: 'payment', label: 'Payment' },
    ];
    if (!this.state.wide) tabs.push({ value: 'chat', label: 'Chat' });
    return tabs;
  }

  get progress(): { steps: ProgressStep[]; offPath: string | null } {
    const task = this.state.task;
    return task ? buildProgress(task.status, task.locationMode, task.statusHistory) : { steps: [], offPath: null };
  }

  /** Status-history entries that carry a reason a person wrote or the system recorded. */
  get notes(): { at: string; reason: string }[] {
    return (this.state.task?.statusHistory ?? [])
      .filter((h): h is typeof h & { reason: string } => Boolean(h.reason))
      .map((h) => ({ at: h.at, reason: h.reason }))
      .reverse();
  }

  get tracking(): boolean {
    const task = this.state.task;
    return task !== null && isTracking(task.status, task.locationMode);
  }

  /** Remount the map when the leg changes (pickup leg → drop-off leg), so it re-frames on the new destination. */
  get liveKey(): string {
    return this.state.task ? `${this.state.task.status}` : 'none';
  }

  get destination(): { latitude: number; longitude: number } {
    const task = this.state.task;
    if (!task) return { latitude: 0, longitude: 0 };
    return task.status === 'IN_PROGRESS' && task.dropoff ? task.dropoff : task.location;
  }

  get destinationLabel(): string {
    const task = this.state.task;
    if (!task?.dropoff) return 'the task location';
    return task.status === 'IN_PROGRESS' ? 'the drop-off' : 'the pickup';
  }

  get workerName(): string {
    return this.ownerTask?.assignedWorker?.displayName ?? 'Your worker';
  }

  /** What is happening now, in a sentence each party can act on. */
  get now(): { title: string; detail: string } {
    const task = this.state.task;
    if (!task) return { title: '', detail: '' };
    const worker = !isOwnerView(task);
    const delivery = task.locationMode === 'PICKUP_DROPOFF';
    const name = this.workerName;
    switch (task.status) {
      case 'DRAFT':
        return { title: 'Not published yet', detail: 'Fund the task to send it to workers nearby.' };
      case 'PUBLISHED':
      case 'MATCHING': {
        const m = this.ownerTask?.matching;
        const reach = m ? ` within ${formatDistance(m.radiusMeters)}` : '';
        const sent = m && m.workersNotified > 0 ? `Sent to ${m.workersNotified} verified worker${m.workersNotified === 1 ? '' : 's'}${reach}. ` : '';
        return {
          title: 'Finding a worker',
          detail: `${sent}The first to accept gets it. It stays open until ${this.deadline}; if nobody accepts by then, you are refunded in full.`,
        };
      }
      case 'ASSIGNED':
        return worker
          ? { title: delivery ? 'Head to the pickup' : 'Head to the location', detail: 'Tap “On my way” when you set off.' }
          : { title: `${name} accepted`, detail: 'You will see them on the map as soon as they set off.' };
      case 'WORKER_EN_ROUTE':
        return worker
          ? { title: delivery ? 'On the way to the pickup' : 'On the way', detail: 'Confirm arrival when you get there.' }
          : { title: `${name} is on the way`, detail: delivery ? 'Heading to the pickup.' : 'Heading to the task location.' };
      case 'ARRIVED':
        return worker
          ? delivery
            ? { title: 'At the pickup', detail: 'Photograph the item to confirm you have collected it.' }
            : { title: 'You have arrived', detail: 'Collect the proof listed below, then submit.' }
          : { title: delivery ? `${name} is at the pickup` : `${name} has arrived`, detail: 'Arrival was checked against the address you gave.' };
      case 'IN_PROGRESS':
        return worker
          ? delivery
            ? { title: 'Delivering', detail: 'Hand it over at the drop-off, add the handover proof, then submit.' }
            : { title: 'Doing the task', detail: 'Add each proof, then submit for review.' }
          : delivery
            ? { title: `${name} has the item`, detail: 'On the way to the drop-off.' }
            : { title: `${name} is doing the task`, detail: 'You will be asked to review the proof when it is submitted.' };
      case 'SUBMITTED':
      case 'UNDER_REVIEW':
        return worker
          ? { title: 'Waiting for review', detail: 'The requester has up to 24 hours, then it auto-approves.' }
          : { title: 'Review the proof', detail: 'Approve to release payment, or send it back with what is missing.' };
      case 'COMPLETED':
        return { title: 'Completed', detail: worker ? 'Approved. Your payout is on its way.' : 'Approved. The worker is being paid.' };
      case 'PAYMENT_RELEASED':
        return { title: 'All done', detail: worker ? 'You have been paid for this task.' : 'The worker has been paid. Thank you.' };
      case 'DISPUTED':
        return { title: 'Under review by OnSite', detail: 'Payment is frozen while an admin looks at the evidence from both sides.' };
      case 'CANCELLED':
        return { title: 'Cancelled', detail: 'This task was cancelled.' };
      case 'EXPIRED':
        return { title: 'Expired', detail: 'Nobody accepted before the deadline. The payment was refunded.' };
      default:
        return { title: task.status, detail: '' };
    }
  }

  get nowIcon(): string {
    const status = this.state.task?.status;
    if (status === 'PUBLISHED' || status === 'MATCHING') return 'radar';
    if (status === 'WORKER_EN_ROUTE' || status === 'ASSIGNED') return 'navigation';
    if (status === 'IN_PROGRESS' && this.state.task?.locationMode === 'PICKUP_DROPOFF') return 'package';
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'file-check';
    if (status === 'COMPLETED' || status === 'PAYMENT_RELEASED') return 'circle-check';
    return 'map-pin';
  }

  get nowClass(): string {
    return 'flex flex-col gap-3 rounded-card border border-brand-100 bg-brand-50 p-4 shadow-card';
  }

  get sharingText(): string {
    const status = this.state.sharing.status;
    if (status === 'denied') return 'Location access is off, so the requester cannot follow your trip. Allow it for this site in your browser settings.';
    if (status === 'unavailable') return 'Your location can’t be read on this device right now.';
    if (status === 'offline') return 'Connection lost. Your position will update as soon as the signal returns.';
    if (status === 'starting') return 'Starting live location…';
    const until = this.state.task?.status === 'IN_PROGRESS' ? 'until you hand it over' : 'until you arrive';
    return `Sharing your live location with the requester ${until}. Keep this screen open.`;
  }

  get sharingClass(): string {
    const bad = ['denied', 'unavailable', 'offline'].includes(this.state.sharing.status);
    return `flex items-start gap-2 rounded-input px-3 py-2 text-sm ${bad ? 'bg-tint-orange text-[#7a3d00]' : 'bg-paper-0 text-ink-700'}`;
  }

  get sharingDotClass(): string {
    return `mt-1.5 h-2 w-2 shrink-0 rounded-full ${this.state.sharing.status === 'sharing' ? 'bg-accent-500' : 'bg-progress'}`;
  }

  /** Whether the requester's money has been taken: anything past a draft. */
  get isPaid(): boolean {
    return this.state.task?.status !== 'DRAFT';
  }

  get paymentStatus(): string {
    const status = this.state.task?.status;
    const worker = Boolean(this.workerTask);
    const refund = this.ownerTask?.money.itemRefundPaise ?? 0;
    const refundNote = refund > 0 ? ` The unspent ${formatPaise(refund)} of the item budget is refunded to you.` : '';
    if (status === 'PAYMENT_RELEASED') return worker ? 'Paid to your payout account.' : `Released to the worker.${refundNote}`;
    if (status === 'COMPLETED') return worker ? 'Approved. Your payout is being sent.' : `Approved. Releasing to the worker.${refundNote}`;
    if (status === 'DISPUTED') return 'Frozen while the dispute is reviewed.';
    if (status === 'CANCELLED' || status === 'EXPIRED') return worker ? 'This task was not paid out.' : 'Refunded to you in full.';
    return worker ? 'Held safely by OnSite. You are paid when the requester approves, or automatically 24 hours after you submit.' : 'Held safely by OnSite until you approve the work.';
  }

  get deadline(): string {
    return this.state.task ? formatDateTime(this.state.task.deadlineAt) : '';
  }

  get rating(): string | null {
    const ratingAvg = this.ownerTask?.assignedWorker?.ratingAvg;
    return ratingAvg === null || ratingAvg === undefined ? null : ratingAvg.toFixed(1);
  }

  get chatVisible(): boolean {
    return this.state.task !== null && CHAT_VISIBLE_STATUSES.includes(this.state.task.status);
  }

  get chatWritable(): boolean {
    return this.state.task !== null && CHAT_WRITABLE_STATUSES.includes(this.state.task.status);
  }

  get reportable(): boolean {
    return this.state.task !== null && REPORTABLE_STATUSES.includes(this.state.task.status);
  }

  get canLeave(): boolean {
    return this.workerTask !== null && LEAVABLE_STATUSES.includes(this.workerTask.status);
  }

  get canRemoveWorker(): boolean {
    const task = this.ownerTask;
    return task !== null && task.assignedWorker !== null && WORKER_REMOVABLE_STATUSES.includes(task.status);
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  setTab = (tab: string) => {
    this.state.tab = tab as Tab;
  };

  onLeft = () => {
    this.sharer?.stop();
    toast('You left the task', { description: 'It has gone back to other workers nearby.' });
    navigate('/feed');
  };

  onWorkerRemoved = () => {
    toast('Worker removed', { description: 'Your task is back in matching. Your payment is still held.', variant: 'success' });
    this.load().catch(() => undefined);
  };

  /** Opens the phone's maps app (or Google Maps on the web) with directions to the point. Only the coordinates are passed. */
  directionsUrl(point: { latitude: number; longitude: number }): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}`;
  }

  when(event: { at: string }): string {
    return formatDateTime(event.at);
  }

  load = async () => {
    const task = await api.get<TaskDetail>(`/tasks/${this.taskId}`);
    let proofs: ProofView[] = [];
    if (PROOF_VISIBLE_STATUSES.includes(task.status)) {
      proofs = (await api.get<{ data: ProofView[] }>(`/tasks/${this.taskId}/proofs`)).data;
    }
    // Bills exist only once a worker is assigned to a task with an item.
    const withItem = isOwnerView(task) ? task.money.itemBudgetPaise > 0 && task.assignedWorker !== null : task.item !== null;
    const bills = withItem ? (await api.get<{ data: ItemBill[] }>(`/tasks/${this.taskId}/purchases`)).data : [];
    this.state.task = task;
    this.state.proofs = proofs;
    this.state.bills = bills;
    await this.syncTracking(task);
  };

  /**
   * Starts or stops the worker's location sharing to match the task's stage,
   * and fetches the last known point so the map is not empty while the next
   * live update is on its way.
   */
  private async syncTracking(task: TaskDetail) {
    const tracking = isTracking(task.status, task.locationMode);
    if (!isOwnerView(task)) {
      if (tracking) {
        if (!this.sharer) {
          this.sharer = new LocationSharer(
            (position) => this.room?.current?.sendLocation(position),
            () => this.room?.current?.connected() ?? false,
            (sharing) => {
              this.state.sharing = sharing;
            },
          );
        }
        this.sharer.start();
      } else {
        this.sharer?.stop();
      }
    }
    if (!tracking) {
      this.state.live = null;
      return;
    }
    try {
      const res = await api.get<{ data: LiveLocationEvent | null }>(`/tasks/${this.taskId}/live-location`);
      if (res.data && (!this.state.live || Date.parse(res.data.at) > Date.parse(this.state.live.at))) {
        this.state.live = { ...res.data, taskId: this.taskId };
      }
    } catch {
      // Live updates over the socket fill the map regardless.
    }
  }
}
