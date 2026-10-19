import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import type { TaskSplit } from '@onsite/money';
import { ModerationNotice, moderationNoticeFrom, type ModerationNoticeData } from '@/components/ModerationNotice';
import { Page } from '@/components/Page';
import { StepProgress } from '@/components/StepProgress';
import type { CategoryView, PickedLocation, ProofRequirement } from '@/lib/api-types';
import {
  buildDraftPayload,
  canAdvance,
  defaultProofFor,
  estimateSplit,
  LAST_STEP,
  parseBudgetPaise,
  STEPS,
} from '@/lib/wizard';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { openRazorpayCheckout } from '@/services/razorpay';
import { store, toast } from '@/store/store';
import { btn, card } from '@/ui/classes';
import { CategoryStep } from './wizard/CategoryStep';
import { DetailsStep } from './wizard/DetailsStep';
import { LocationStep } from './wizard/LocationStep';
import { ProofStep } from './wizard/ProofStep';
import { ReviewStep, type DraftTask } from './wizard/ReviewStep';

interface PaymentOrderView {
  id: string;
  status: string;
  razorpay?: { orderId: string; keyId: string | null };
}

type TextField = 'title' | 'description' | 'deadlineLocal' | 'budgetRupees';

interface WizardState {
  step: number;
  categories: CategoryView[];
  loaded: boolean;
  loadError: string | null;
  category: CategoryView | null;
  /** The task location; the pickup point for pickup & delivery categories. */
  pickup: PickedLocation | null;
  /** Pickup & delivery categories only. */
  dropoff: PickedLocation | null;
  title: string;
  description: string;
  deadlineLocal: string;
  budgetRupees: string;
  proofRequirements: ProofRequirement[];
  draft: DraftTask | null;
  submitting: boolean;
  submitError: string | null;
  moderation: ModerationNoticeData | null;
}

const PAYMENT_POLL_ATTEMPTS = 20;
const PAYMENT_POLL_MS = 1500;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The five-step task wizard: one decision per screen, nothing charged until
 * the last. Creating the task is two phases: a draft (the server returns the
 * real fee split), then funding, which only publishes once the server says the
 * payment is CAPTURED. The client never asserts payment state.
 */
export class NewTaskView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'My tasks', to: '/tasks' }, { label: 'Post a task' }]">
      <p t-if="state.loadError" role="alert" class="text-sm text-dispute" t-out="state.loadError"/>
      <div t-else="" class="mx-auto flex max-w-2xl flex-col gap-6">
        <p class="text-sm text-ink-500">One decision per screen. Nothing is charged until the last step.</p>

        <ModerationNotice t-if="state.moderation" t-key="state.moderation.eventId or state.moderation.kind"
          notice="state.moderation" onExpired="onRestrictionExpired"/>

        <StepProgress steps="steps" current="state.step"/>

        <div t-att-class="cardClass">
          <div class="p-6">
            <CategoryStep t-if="state.step === 0"
              categories="state.categories" selectedId="selectedCategoryId" loading="!state.loaded"
              onSelect="selectCategory"/>
            <LocationStep t-elif="state.step === 1"
              wizard="state" mode="locationMode" onPickup="setPickup" onDropoff="setDropoff"/>
            <DetailsStep t-elif="state.step === 2" wizard="state" onField="setField" estimate="estimate"/>
            <ProofStep t-elif="state.step === 3"
              requirements="state.proofRequirements"
              onUpdate="updateProof" onRemove="removeProof" onAdd="addProof"/>
            <ReviewStep t-else=""
              wizard="state" draft="draft" estimate="estimate"
              submitting="state.submitting" submitError="submitError"
              onCreateDraft="createDraft" onFundAndPublish="fundAndPublish"/>
          </div>
        </div>

        <!-- On phones the Back/Continue bar floats at the bottom, within thumb reach (the tab bar is hidden here). -->
        <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+8px)] z-20 flex justify-between gap-3 rounded-sheet border border-line-light bg-white/95 p-2 shadow-float backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
          <button type="button" t-att-class="backClass" t-att-disabled="state.step === 0 or state.submitting" t-on-click="back">Back</button>
          <button t-if="showContinue" type="button" t-att-class="continueClass" t-att-disabled="!advanceable" t-on-click="next">Continue</button>
        </div>
      </div>
    </Page>`;
  static components = { CategoryStep, DetailsStep, LocationStep, ModerationNotice, Page, ProofStep, ReviewStep, StepProgress };
  static override props = {};

  store = useState(store);
  state = useState<WizardState>({
    step: 0,
    categories: [],
    loaded: false,
    loadError: null,
    category: null,
    pickup: null,
    dropoff: null,
    title: '',
    description: '',
    deadlineLocal: '',
    budgetRupees: '',
    proofRequirements: [],
    draft: null,
    submitting: false,
    submitError: null,
    moderation: null,
  });

  steps: string[] = [...STEPS];
  cardClass = card('overflow-visible');
  backClass = btn('ghost');
  continueClass = btn('primary', 'default', 'flex-1 md:flex-none md:px-8');

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.loadReferenceData();
      void this.loadRestriction();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  // ─── Derived values ────────────────────────────────────────────────────

  get selectedCategoryId(): string {
    return this.state.category?.id ?? '';
  }

  private get budgetPaise(): number | null {
    return parseBudgetPaise(this.state.budgetRupees);
  }

  get estimate(): TaskSplit | undefined {
    return estimateSplit(this.budgetPaise) ?? undefined;
  }

  get draft(): DraftTask | undefined {
    return this.state.draft ?? undefined;
  }

  get submitError(): string | undefined {
    return this.state.submitError ?? undefined;
  }

  get showContinue(): boolean {
    return this.state.step < LAST_STEP;
  }

  get locationMode(): 'SINGLE' | 'PICKUP_DROPOFF' {
    return this.state.category?.locationMode ?? 'SINGLE';
  }

  get advanceable(): boolean {
    const s = this.state;
    return canAdvance(s.step, {
      hasCategory: s.category !== null,
      locationMode: this.locationMode,
      pickup: s.pickup,
      dropoff: s.dropoff,
      title: s.title,
      description: s.description,
      deadlineLocal: s.deadlineLocal,
      budgetPaise: this.budgetPaise,
      proofRequirements: s.proofRequirements,
    });
  }

  // ─── Navigation ────────────────────────────────────────────────────────

  private goToStep(target: number) {
    // The draft only exists while on the review step. Reaching here with one
    // means the user went Back to edit something, so the server-computed
    // numbers in that draft are stale: drop it rather than keep showing them.
    // The review step falls back to its live estimate until "Create task" is
    // pressed again.
    if (this.state.draft) {
      this.state.draft = null;
      this.state.submitError = null;
    }
    this.state.step = target;
  }

  next() {
    this.goToStep(this.state.step + 1);
  }

  back() {
    this.goToStep(this.state.step - 1);
  }

  // ─── Field handlers (passed to the steps) ──────────────────────────────

  setField = (key: TextField, value: string) => {
    this.state[key] = value;
  };

  selectCategory = (category: CategoryView) => {
    this.state.category = category;
    this.state.proofRequirements = defaultProofFor(category);
    // A one-place category never carries a drop-off.
    if (category.locationMode === 'SINGLE') this.state.dropoff = null;
  };

  setPickup = (location: PickedLocation | null) => {
    this.state.pickup = location;
  };

  setDropoff = (location: PickedLocation | null) => {
    this.state.dropoff = location;
  };

  updateProof = (index: number, patch: Partial<ProofRequirement>) => {
    this.state.proofRequirements = this.state.proofRequirements.map((r, i) => (i === index ? { ...r, ...patch } : r));
  };

  removeProof = (index: number) => {
    this.state.proofRequirements = this.state.proofRequirements.filter((_, i) => i !== index);
  };

  addProof = () => {
    this.state.proofRequirements = [...this.state.proofRequirements, { type: 'NOTE', label: '', required: true }];
  };

  // ─── Server calls ──────────────────────────────────────────────────────

  private async loadReferenceData() {
    try {
      const categories = await api.get<{ data: CategoryView[] }>('/categories');
      if (this.disposed) return;
      this.state.categories = categories.data;
      this.state.loaded = true;
    } catch {
      if (!this.disposed) this.state.loadError = 'Could not load categories. Refresh to try again.';
    }
  }

  /** Shows the cooldown up front, before the user fills in five screens only to be refused. */
  private async loadRestriction() {
    try {
      const r = await api.get<{ restricted: boolean; eventId?: string; restrictedUntil?: string; reason?: string }>(
        '/moderation/restriction',
      );
      if (this.disposed || !r.restricted) return;
      this.state.moderation = {
        kind: 'restricted',
        message: `A recent task broke our rules (${r.reason ?? 'prohibited content'}), so posting and editing tasks is paused for a few minutes.`,
        eventId: r.eventId,
        restrictedUntil: r.restrictedUntil,
      };
    } catch {
      // Purely informational; the API enforces the pause regardless.
    }
  }

  onRestrictionExpired = () => {
    if (this.state.moderation?.kind === 'restricted') this.state.moderation = null;
  };

  /** Moderation refusals get the full notice instead of a one-line error. */
  private showError(error: unknown, fallback: string) {
    const notice = moderationNoticeFrom(error);
    if (notice) {
      this.state.moderation = notice;
      this.state.submitError = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.state.submitError = error instanceof ApiError ? error.message : fallback;
  }

  createDraft = async () => {
    const { state } = this;
    const budgetPaise = this.budgetPaise;
    const pickup = state.pickup;
    if (!state.category || !pickup || budgetPaise === null) return;
    const dropoff = this.locationMode === 'PICKUP_DROPOFF' ? state.dropoff : null;
    state.submitting = true;
    state.submitError = null;
    try {
      state.draft = await api.post<DraftTask>(
        '/tasks',
        buildDraftPayload({
          title: state.title,
          description: state.description,
          categorySlug: state.category.slug,
          pickup,
          dropoff,
          budgetPaise,
          deadlineLocal: state.deadlineLocal,
          proofRequirements: state.proofRequirements,
        }),
      );
    } catch (error) {
      this.showError(error, 'Could not create the task. Try again.');
    } finally {
      state.submitting = false;
    }
  };

  fundAndPublish = async () => {
    const { state } = this;
    const draft = state.draft;
    if (!draft) return;
    state.submitting = true;
    state.submitError = null;
    try {
      const order = await api.post<PaymentOrderView>(
        '/payments/orders',
        { taskId: draft.id },
        { idempotencyKey: `create-${draft.id}` },
      );

      if (order.razorpay?.orderId && order.razorpay.keyId) {
        // Real gateway: the modal completing is not proof of capture. Only the
        // signed webhook is (docs/16-security-requirements.md), so poll the
        // server's own view of the payment instead of trusting the callback.
        const outcome = await openRazorpayCheckout({
          keyId: order.razorpay.keyId,
          orderId: order.razorpay.orderId,
          amountPaise: draft.money.budgetPaise,
          description: draft.title,
          prefillEmail: this.store.user?.email,
        });

        if (outcome === 'dismissed') {
          state.submitError = 'Payment window closed before completing. Try again when ready.';
          return;
        }

        state.submitError = 'Confirming your payment with the bank — this can take a few seconds…';
        let captured = false;
        for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS && !captured; attempt++) {
          await wait(PAYMENT_POLL_MS);
          if (this.disposed) return;
          const status = await api.get<PaymentOrderView>(`/payments/${draft.id}`);
          captured = status.status === 'CAPTURED';
        }
        if (!captured) {
          state.submitError =
            'Payment is still confirming. This page will not auto-publish — check back in a minute, or reload.';
          return;
        }
        state.submitError = null;
      }

      await api.post(`/tasks/${draft.id}/publish`);
      toast('Task published', { description: 'Funds are held in escrow until you approve the work.', variant: 'success' });
      navigate(`/tasks/${draft.id}`);
    } catch (error) {
      this.showError(error, 'Payment or publishing failed. Try again.');
    } finally {
      state.submitting = false;
    }
  };
}
