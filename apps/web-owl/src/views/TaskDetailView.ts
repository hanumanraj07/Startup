import { Component, onMounted, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { Icon } from '@/components/Icon';
import { Link } from '@/components/Link';
import { MoneyBreakdown } from '@/components/MoneyBreakdown';
import { Page, type Crumb } from '@/components/Page';
import { StatusPill } from '@/components/StatusPill';
import { useTaskSocket } from '@/hooks/use-task-socket';
import {
  isOwnerView,
  type OwnerTask,
  type ProofView,
  type TaskDetail,
  type WorkerTask,
} from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
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
import { toast } from '@/store/store';
import { card, CARD_CONTENT } from '@/ui/classes';
import { ChatPanel } from './task/ChatPanel';
import { ReleaseAssignmentDialog } from './task/ReleaseAssignmentDialog';
import { ReportIssueDialog } from './task/ReportIssueDialog';
import { RequesterActions } from './task/RequesterActions';
import { WorkerActions } from './task/WorkerActions';

const BAR = 'skeleton rounded-md';

/**
 * A task as an Odoo-style form: a white "sheet" (title, status, location,
 * description) beside a "chatter" (the conversation), with the actions the
 * viewer's role allows in between. Status changes arrive over the task's
 * socket room, so the page updates without a manual refresh.
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
              <div class="mt-2 h-4 w-full ${BAR}"/><div class="h-4 w-5/6 ${BAR}"/>
            </div>
          </div>
          <div class="h-20 w-full ${BAR}"/>
        </div>
      </div>

      <div t-else="" class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="flex min-w-0 flex-col gap-4">
          <div t-att-class="cardClass">
            <div class="${CARD_CONTENT} flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <StatusPill status="task.status"/>
                <span class="text-sm text-ink-400" t-out="task.categoryName"/>
              </div>
              <h1 class="text-2xl font-semibold tracking-tight text-ink-900" t-out="task.title"/>
              <div t-if="task.dropoff" class="mt-1 flex flex-col gap-0 rounded-input border border-line-light p-1" role="group" aria-label="Route">
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
                <Icon name="'map-pin'" size="16"/> <t t-out="task.location.address"/>
                <a t-if="workerTask" t-att-href="directionsUrl(task.location)" target="_blank" rel="noreferrer" t-att-class="directionsClass + ' ml-auto'">Directions</a>
              </p>
              <p class="mt-1 whitespace-pre-wrap border-t border-line pt-4 text-[15px] text-ink-700" t-out="task.description"/>
            </div>
          </div>

          <MoneyBreakdown t-if="ownerTask"
            budgetPaise="ownerTask.money.budgetPaise"
            commissionPaise="ownerTask.money.commissionPaise"
            workerPayoutPaise="ownerTask.money.workerPayoutPaise"/>
          <div t-if="workerTask" class="rounded-card border border-line bg-paper-100 p-4">
            <div class="flex items-center justify-between text-[15px]">
              <span class="text-ink-900">You receive</span>
              <span class="tabular font-semibold text-verified" t-out="payout"/>
            </div>
          </div>

          <Link t-if="ownerTask and ownerTask.assignedWorker" to="'/profile/' + ownerTask.assignedWorker.id" class="'block'">
            <div t-att-class="cardClass + ' transition-colors duration-micro ease-onsite hover:bg-paper-100'">
              <div class="${CARD_CONTENT} flex items-center justify-between">
                <div>
                  <p class="font-medium text-ink-900" t-out="ownerTask.assignedWorker.displayName"/>
                  <p class="text-sm text-ink-500"><t t-out="ownerTask.assignedWorker.tasksCompleted"/> tasks completed</p>
                </div>
                <span t-if="rating" class="tabular text-sm font-semibold text-ink-900"><t t-out="rating"/> ★</span>
              </div>
            </div>
          </Link>

          <div t-if="workerTask" t-att-class="cardClass">
            <div class="${CARD_CONTENT}">
              <p class="text-sm text-ink-500">Posted by</p>
              <p class="font-medium text-ink-900" t-out="workerTask.requester.displayName"/>
            </div>
          </div>

          <WorkerActions t-if="workerTask"
            taskId="task.id" status="task.status" proofRequirements="task.proofRequirements"
            proofs="state.proofs" onChanged="load"/>
          <RequesterActions t-if="ownerTask"
            taskId="task.id" status="task.status" proofs="state.proofs" onChanged="load"/>

          <div t-if="reportable or canLeave or canRemoveWorker" class="flex flex-wrap items-center gap-2">
            <ReportIssueDialog t-if="reportable" taskId="task.id" onReported="load"/>
            <ReleaseAssignmentDialog t-if="canLeave" taskId="task.id" mode="'leave'" onDone="onLeft"/>
            <ReleaseAssignmentDialog t-if="canRemoveWorker" taskId="task.id" mode="'remove'"
              workerName="ownerTask.assignedWorker.displayName" onDone="onWorkerRemoved"/>
          </div>

          <div>
            <h2 class="mb-3 text-lg font-medium text-ink-900">Timeline</h2>
            <ol class="flex flex-col gap-4 border-l border-line pl-4">
              <li t-foreach="task.statusHistory" t-as="event" t-key="event_index" class="relative">
                <span class="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden="true"/>
                <StatusPill status="event.status"/>
                <p class="mt-1 text-xs text-ink-400"><t t-out="when(event)"/> · <t t-out="event.actorRole.toLowerCase()"/></p>
                <p t-if="event.reason" class="mt-1 text-sm text-ink-500" t-out="event.reason"/>
              </li>
            </ol>
          </div>
        </div>

        <ChatPanel t-if="chatVisible" taskId="task.id" closed="!chatWritable"/>
      </div>
    </Page>`;
  static components = {
    ChatPanel,
    Icon,
    Link,
    MoneyBreakdown,
    Page,
    ReleaseAssignmentDialog,
    ReportIssueDialog,
    RequesterActions,
    StatusPill,
    WorkerActions,
  };
  static override props = {};

  state = useState<{ task: TaskDetail | null; proofs: ProofView[]; error: string | null }>({
    task: null,
    proofs: [],
    error: null,
  });

  cardClass = card();
  directionsClass = 'shrink-0 rounded-full bg-paper-100 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-line';

  private readonly taskId = routerState.params['id'] ?? '';

  override setup() {
    onMounted(() => {
      this.load().catch((err) => {
        this.state.error = err instanceof ApiError ? err.message : 'Could not load this task.';
      });
    });

    // A status change from the other party (worker marking en route,
    // requester approving) arrives over the socket instead of needing a refresh.
    if (this.taskId) {
      useTaskSocket(this.taskId, {
        onStatus: () => {
          this.load().catch((err) => {
            // The worker's view of a task disappears once they are released
            // from it (removed by the requester, or left on another device).
            if (err instanceof ApiError && err.status === 404 && this.workerTask) {
              this.state.task = null;
              this.state.error = 'You are no longer assigned to this task. It has gone back to other workers.';
            }
          });
        },
      });
    }
  }

  /** The loaded task; the template only reads it in the branch where it is present. */
  get task(): TaskDetail | null {
    return this.state.task;
  }

  get ownerTask(): OwnerTask | null {
    const task = this.state.task;
    return task && isOwnerView(task) ? task : null;
  }

  get workerTask(): WorkerTask | null {
    const task = this.state.task;
    return task && !isOwnerView(task) ? task : null;
  }

  get breadcrumbs(): Crumb[] {
    return [{ label: 'My tasks', to: '/tasks' }, { label: this.state.task?.title ?? 'Task' }];
  }

  get payout(): string {
    return this.workerTask ? formatPaise(this.workerTask.payoutPaise) : '';
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

  onLeft = () => {
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
    this.state.task = task;
    this.state.proofs = proofs;
  };
}
