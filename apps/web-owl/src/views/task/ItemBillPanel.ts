import { Component, onWillUnmount, useRef, useState, xml } from '@odoo/owl';
import { formatPaise } from '@onsite/money';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { parseBudgetPaise } from '@/lib/wizard';
import type { ItemBill } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { openRazorpayCheckout } from '@/services/razorpay';
import { toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_HEADER, CARD_TITLE, LABEL } from '@/ui/classes';

const money = (paise: number) => formatPaise(paise, { forceDecimals: true });
/** Reads the shop's UPI ID and name out of a upi://pay QR code. */
function parseUpiQr(raw: string): { vpa: string; name: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'upi:') return null;
    const vpa = url.searchParams.get('pa');
    return vpa ? { vpa, name: url.searchParams.get('pn') ?? '' } : null;
  } catch {
    return null;
  }
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

/**
 * Buying an item, P6: the worker sends the bill from the shop, the requester
 * approves the exact amount before anything is paid. One component, two
 * sides, so both always describe the same bill the same way. Money figures
 * are calm and tabular, per docs/19-ui-design-system.md.
 */
export class ItemBillPanel extends Component {
  static override template = xml`
    <section t-if="visible" t-att-class="cardClass" aria-labelledby="bill-title">
      <div class="${CARD_HEADER}">
        <h2 id="bill-title" class="${CARD_TITLE} flex items-center gap-2"><Icon name="'shopping-bag'" size="18"/> <t t-out="title"/></h2>
      </div>
      <div class="${CARD_CONTENT} flex flex-col gap-4">

        <!-- The bill being decided, or the approved one. -->
        <div t-if="current" class="flex flex-col gap-3 rounded-card border border-line bg-paper-100 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-ink-900" t-out="current.description"/>
              <p class="text-sm text-ink-500" t-out="methodText(current)"/>
            </div>
            <span class="tabular shrink-0 text-xl font-bold text-ink-900" t-out="money(current.amountPaise)"/>
          </div>
          <a t-if="current.billUrl" t-att-href="current.billUrl" target="_blank" rel="noreferrer" class="block">
            <img t-att-src="current.billUrl" alt="Photo of the bill" class="max-h-56 w-full rounded-input object-contain bg-paper-0"/>
          </a>
          <p t-if="current.topUpPaise > 0 and current.status === 'PENDING_APPROVAL'" class="rounded-input bg-tint-orange px-3 py-2 text-sm text-[#7a3d00]">
            <t t-out="money(current.topUpPaise)"/> more than what is left of the item budget.
            <t t-if="props.role === 'requester'">You pay this now to approve it.</t>
            <t t-else="">The requester pays this to approve it.</t>
          </p>
          <p t-if="current.status === 'PENDING_APPROVAL'" class="tabular flex items-center gap-1.5 text-sm text-ink-700" role="status">
            <Icon name="'clock'" size="14"/> <t t-out="countdown"/>
          </p>
        </div>

        <!-- Requester: decide. -->
        <t t-if="props.role === 'requester' and current and current.status === 'PENDING_APPROVAL'">
          <p class="text-sm text-ink-700">Nothing is paid until you approve. Check the photo and the amount; if anything is off, reject it and say why in chat.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" t-att-class="approveClass" t-att-disabled="state.busy" t-on-click="approve">
              <Icon name="'check'" size="16"/> <t t-out="approveLabel"/>
            </button>
            <button type="button" t-att-class="rejectClass" t-att-disabled="state.busy" t-on-click="reject">
              <Icon name="'x'" size="16"/> Reject
            </button>
          </div>
        </t>

        <!-- Requester: approved, the handover code. -->
        <div t-if="props.role === 'requester' and props.handover" class="flex flex-col gap-1 rounded-card border-2 border-ink-900 bg-paper-0 p-4 text-center">
          <t t-if="props.handover.confirmed">
            <p class="flex items-center justify-center gap-2 font-semibold text-verified"><Icon name="'circle-check'" size="18"/> Item handed over</p>
          </t>
          <t t-else="">
            <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Handover code</p>
            <p class="tabular text-4xl font-bold tracking-[0.3em] text-ink-900" t-out="props.handover.code"/>
            <p class="text-sm text-ink-700">Give it to the worker only once the item is in your hands, or share it with whoever receives it. It confirms the delivery.</p>
          </t>
        </div>

        <!-- Worker: waiting. -->
        <t t-if="props.role === 'worker' and current and current.status === 'PENDING_APPROVAL'">
          <p class="text-sm text-ink-700">Don’t pay yet. The requester has been asked to approve this bill.</p>
          <button type="button" t-att-class="secondaryClass + ' self-start'" t-att-disabled="state.busy" t-on-click="withdraw">Withdraw the bill</button>
        </t>

        <!-- Worker: approved. -->
        <t t-if="props.role === 'worker' and current and current.status === 'APPROVED'">
          <t t-if="current.method === 'SHOP_UPI'">
            <p t-if="current.shopPayment and current.shopPayment.status === 'PROCESSED'" class="flex items-start gap-2 rounded-input bg-brand-50 px-3 py-2 text-sm text-ink-900">
              <span class="mt-0.5 shrink-0"><Icon name="'circle-check'" size="16"/></span>
              <span>Paid to the shop (reference <span class="tabular" t-out="current.shopPayment.reference"/>). Show this to the shop and collect the item. You pay nothing.</span>
            </p>
            <t t-elif="current.shopPayment and current.shopPayment.status === 'FAILED'">
              <p role="alert" class="text-sm text-dispute" t-out="current.shopPayment.failureReason"/>
              <div class="flex flex-wrap gap-2">
                <button type="button" t-att-class="primaryClass" t-att-disabled="state.busy" t-on-click="retryPayment">Try the payment again</button>
                <button t-if="current.amountPaise &lt;= cashCap" type="button" t-att-class="secondaryClass" t-att-disabled="state.busy" t-on-click="payCash">The shop takes cash: I’ll pay</button>
              </div>
            </t>
            <p t-else="" class="text-sm text-ink-700">Paying the shop…</p>
          </t>
          <p t-else="" class="flex items-start gap-2 rounded-input bg-brand-50 px-3 py-2 text-sm text-ink-900">
            <span class="mt-0.5 shrink-0"><Icon name="'wallet'" size="16"/></span>
            <span>Approved: pay exactly <strong class="tabular" t-out="money(current.amountPaise)"/> in cash. You get it back as soon as the handover code is entered at the drop-off.</span>
          </p>
        </t>

        <!-- Worker: send a bill. -->
        <t t-if="props.role === 'worker' and canSend">
          <p t-if="lastDecided" class="rounded-input bg-paper-100 px-3 py-2 text-sm text-ink-700" t-out="lastDecidedText"/>
          <p class="text-sm text-ink-700">
            At the shop, don’t pay yet. Send the bill: the requester approves the exact amount, then the shop is paid.
            Set aside: <strong class="tabular" t-out="money(props.item.budgetPaise)"/>.
          </p>

          <div class="flex flex-col gap-1.5">
            <span class="${LABEL}">Photo of the bill or price tag</span>
            <input t-ref="bill" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="hidden" t-on-change="onBill"/>
            <div class="flex items-center gap-3">
              <button type="button" t-att-class="secondaryClass" t-att-disabled="state.busy" t-on-click="pickBill">
                <Icon name="'camera'" size="16"/> <t t-out="state.billKey ? 'Retake' : 'Take photo'"/>
              </button>
              <span t-if="state.uploading" class="text-sm text-ink-500">Uploading…</span>
              <span t-elif="state.billKey" class="flex items-center gap-1 text-sm text-verified"><Icon name="'check'" size="14"/> Added</span>
            </div>
          </div>

          <TextField id="'bill-what'" label="'What are you buying?'" placeholder="'e.g. 2 × Amul butter 500 g'" value="state.description" onInput="setDescription"/>
          <TextField id="'bill-amount'" label="'Amount on the bill (₹)'" type="'number'" min="'1'" step="'0.01'"
            value="state.amount" onInput="setAmount" hint="amountHint"/>

          <fieldset class="flex flex-col gap-2">
            <legend class="${LABEL} mb-1.5">How will the shop be paid?</legend>
            <label t-if="props.item.shopPaymentAvailable" t-att-class="optionClass('SHOP_UPI')">
              <input type="radio" name="bill-method" value="SHOP_UPI" class="mt-1" t-att-checked="state.method === 'SHOP_UPI'" t-on-change="() => setMethod('SHOP_UPI')"/>
              <span><strong class="block text-ink-900">OnSite pays the shop by UPI</strong><span class="text-sm text-ink-500">Best: you pay nothing. Needs the shop’s UPI ID.</span></span>
            </label>
            <label t-att-class="optionClass('WORKER_CASH')">
              <input type="radio" name="bill-method" value="WORKER_CASH" class="mt-1" t-att-checked="state.method === 'WORKER_CASH'" t-on-change="() => setMethod('WORKER_CASH')"/>
              <span><strong class="block text-ink-900">Cash only: I pay</strong><span class="text-sm text-ink-500">Up to <t t-out="money(cashCap)"/>. Repaid when the handover code is entered.</span></span>
            </label>
          </fieldset>

          <t t-if="state.method === 'SHOP_UPI'">
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <TextField id="'bill-vpa'" label="'Shop’s UPI ID'" placeholder="'shopname@okaxis'" value="state.vpa" onInput="setVpa"/>
              </div>
              <t t-if="canScan">
                <input t-ref="qr" type="file" accept="image/*" capture="environment" class="hidden" t-on-change="onQr"/>
                <button type="button" t-att-class="secondaryClass" t-att-disabled="state.busy" t-on-click="pickQr">Scan QR</button>
              </t>
            </div>
            <TextField id="'bill-shop'" label="'Shop name (optional)'" value="state.shopName" onInput="setShopName"/>
          </t>

          <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
          <button type="button" t-att-class="sendClass" t-att-disabled="state.busy or !ready" t-on-click="send">
            <Icon name="'send'" size="16"/> Send bill for approval
          </button>
        </t>

        <p t-if="state.error and !canSend" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      </div>
    </section>`;
  static components = { Icon, TextField };
  static override props = {
    taskId: String,
    role: String,
    status: String,
    bills: Array,
    onChanged: Function,
    /** Worker only: the item as GET /tasks/:id gives it. */
    item: { type: Object, optional: true },
    /** Requester only: the handover code once a bill is approved. */
    handover: { type: Object, optional: true },
  };

  bill = useRef('bill');
  qr = useRef('qr');
  state = useState({
    busy: false,
    uploading: false,
    error: null as string | null,
    billKey: null as string | null,
    description: '',
    amount: '',
    method: 'WORKER_CASH' as 'SHOP_UPI' | 'WORKER_CASH',
    vpa: '',
    shopName: '',
    now: Date.now(),
  });

  cardClass = card();
  primaryClass = btn('primary');
  approveClass = btn('primary', 'lg');
  rejectClass = btn('secondary', 'lg');
  secondaryClass = btn('secondary');
  sendClass = btn('primary', 'lg', 'w-full');
  money = money;

  override setup() {
    const timer = setInterval(() => {
      this.state.now = Date.now();
    }, 1000);
    onWillUnmount(() => clearInterval(timer));
    if (this.props.item?.shopPaymentAvailable) this.state.method = 'SHOP_UPI';
  }

  get bills(): ItemBill[] {
    return this.props.bills as ItemBill[];
  }

  /** The open bill, or the approved one. Older answered bills only explain why a new one is needed. */
  get current(): ItemBill | null {
    return this.bills.find((b) => b.status === 'PENDING_APPROVAL' || b.status === 'APPROVED') ?? null;
  }

  get lastDecided(): ItemBill | null {
    const last = this.bills[0];
    return last && (last.status === 'REJECTED' || last.status === 'EXPIRED') ? last : null;
  }

  get lastDecidedText(): string {
    const last = this.lastDecided;
    if (!last) return '';
    if (last.status === 'EXPIRED') return `Your ${money(last.amountPaise)} bill was not answered in time. Send it again, or ask in chat.`;
    return `Your ${money(last.amountPaise)} bill was not approved${last.rejectReason ? `: ${last.rejectReason}` : '.'} Don’t buy it.`;
  }

  get visible(): boolean {
    if (this.props.role === 'requester') return this.bills.length > 0 || Boolean(this.props.handover);
    return Boolean(this.props.item) && (this.canSend || this.current !== null);
  }

  get title(): string {
    const c = this.current;
    if (this.props.role === 'requester') {
      if (c?.status === 'PENDING_APPROVAL') return 'Approve the bill';
      return 'The item';
    }
    if (c?.status === 'PENDING_APPROVAL') return 'Waiting for approval';
    if (c?.status === 'APPROVED') return 'Bill approved';
    return 'Buy the item';
  }

  /** A worker at the pickup with no open or approved bill. */
  get canSend(): boolean {
    return (
      this.props.role === 'worker' &&
      (this.props.status === 'ARRIVED' || this.props.status === 'IN_PROGRESS') &&
      this.current === null &&
      this.props.item?.spentPaise === null
    );
  }

  get cashCap(): number {
    return this.props.item?.cashCapPaise ?? 0;
  }

  get countdown(): string {
    const c = this.current;
    if (!c) return '';
    const left = Math.max(0, new Date(c.expiresAt).getTime() - this.state.now);
    if (left === 0) return 'Time is up. It can no longer be approved.';
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')} left to approve`;
  }

  get approveLabel(): string {
    const c = this.current;
    if (!c) return 'Approve';
    return c.topUpPaise > 0 ? `Approve and pay ${money(c.topUpPaise)}` : `Approve ${money(c.amountPaise)}`;
  }

  methodText(bill: ItemBill): string {
    if (bill.method === 'WORKER_CASH') return 'Cash: the worker pays and is repaid at the handover';
    const shop = bill.merchantName ? `${bill.merchantName} · ` : '';
    return `OnSite pays the shop by UPI: ${shop}${bill.merchantVpa ?? ''}`;
  }

  optionClass(method: string): string {
    const on = this.state.method === method;
    return `flex cursor-pointer items-start gap-3 rounded-input border p-3 ${on ? 'border-ink-900 bg-paper-100' : 'border-line bg-paper-0'}`;
  }

  get amountPaise(): number | null {
    return parseBudgetPaise(this.state.amount.trim());
  }

  get amountHint(): string {
    const amount = this.amountPaise;
    const budget = this.props.item?.budgetPaise ?? 0;
    if (amount !== null && amount > budget) {
      return `${money(amount - budget)} over the budget: the requester pays the difference when approving.`;
    }
    return 'Exactly as on the bill. The requester approves this amount.';
  }

  get canScan(): boolean {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window;
  }

  get ready(): boolean {
    const amount = this.amountPaise;
    if (!this.state.billKey || amount === null || amount <= 0 || this.state.description.trim().length < 3) return false;
    if (this.state.method === 'SHOP_UPI') return /^[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9]+$/.test(this.state.vpa.trim());
    return amount <= this.cashCap;
  }

  setDescription = (v: string) => {
    this.state.description = v;
  };
  setAmount = (v: string) => {
    this.state.amount = v;
  };
  setVpa = (v: string) => {
    this.state.vpa = v;
  };
  setShopName = (v: string) => {
    this.state.shopName = v;
  };
  setMethod = (m: 'SHOP_UPI' | 'WORKER_CASH') => {
    this.state.method = m;
  };

  pickBill = () => (this.bill.el as HTMLInputElement | null)?.click();
  pickQr = () => (this.qr.el as HTMLInputElement | null)?.click();

  onBill = async (ev: Event) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.state.uploading = true;
    this.state.error = null;
    try {
      const presign = await api.post<{ storageKey: string; uploadUrl: string }>(`/tasks/${this.props.taskId}/proofs/presign`, {
        type: 'PHOTO',
        contentType: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', 'The photo did not upload. Try again.');
      this.state.billKey = presign.storageKey;
    } catch (err) {
      this.state.error = err instanceof ApiError ? err.message : 'The photo did not upload. Try again.';
    } finally {
      this.state.uploading = false;
    }
  };

  onQr = async (ev: Event) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      const codes = await new Detector({ formats: ['qr_code'] }).detect(await createImageBitmap(file));
      const upi = codes.map((c) => parseUpiQr(c.rawValue)).find(Boolean);
      if (!upi) throw new Error('no upi');
      this.state.vpa = upi.vpa;
      if (upi.name && !this.state.shopName) this.state.shopName = upi.name;
      this.state.error = null;
    } catch {
      this.state.error = 'Could not read a UPI QR code in that photo. Type the UPI ID instead.';
    }
  };

  private async run(action: () => Promise<unknown>, success?: string) {
    this.state.busy = true;
    this.state.error = null;
    try {
      await action();
      if (success) toast(success, { variant: 'success' });
      await this.props.onChanged();
    } catch (err) {
      this.state.error = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
    } finally {
      this.state.busy = false;
    }
  }

  send = () =>
    this.run(async () => {
      await api.post(`/tasks/${this.props.taskId}/purchases`, {
        amountPaise: this.amountPaise,
        description: this.state.description.trim(),
        billStorageKey: this.state.billKey,
        method: this.state.method,
        ...(this.state.method === 'SHOP_UPI'
          ? { merchantVpa: this.state.vpa.trim(), ...(this.state.shopName.trim() ? { merchantName: this.state.shopName.trim() } : {}) }
          : {}),
      });
      this.state.billKey = null;
      this.state.amount = '';
      this.state.description = '';
    }, 'Bill sent. Wait for approval before paying.');

  withdraw = () => this.run(() => api.post(`/tasks/${this.props.taskId}/purchases/${this.current?.id}/withdraw`));
  retryPayment = () => this.run(() => api.post(`/tasks/${this.props.taskId}/purchases/${this.current?.id}/retry-payment`));
  payCash = () => this.run(() => api.post(`/tasks/${this.props.taskId}/purchases/${this.current?.id}/pay-cash`));

  reject = () => {
    const reason = window.prompt('Why are you rejecting this bill? (optional)') ?? undefined;
    return this.run(
      () =>
        api.post(`/tasks/${this.props.taskId}/purchases/${this.current?.id}/reject`, reason?.trim() ? { reason: reason.trim() } : {}),
      'Bill rejected. The worker has been told not to buy it.',
    );
  };

  approve = () =>
    this.run(async () => {
      const bill = this.current;
      if (!bill) return;
      const result = await api.post<{ purchase: ItemBill; topUp?: { amountPaise: number; razorpay?: { orderId: string; keyId: string | null } } }>(
        `/tasks/${this.props.taskId}/purchases/${bill.id}/approve`,
      );
      const checkout = result.topUp?.razorpay;
      if (!checkout || !checkout.keyId) return;
      // As with funding a task: the modal finishing is not proof of capture.
      // The signed webhook is, and reading the bills again completes it.
      const outcome = await openRazorpayCheckout({
        keyId: checkout.keyId,
        orderId: checkout.orderId,
        amountPaise: result.topUp?.amountPaise ?? 0,
        description: `Item top-up: ${bill.description}`,
      });
      if (outcome === 'dismissed') throw new ApiError(0, 'DISMISSED', 'Payment window closed. The bill is still waiting for you.');
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        const bills = (await api.get<{ data: ItemBill[] }>(`/tasks/${this.props.taskId}/purchases`)).data;
        if (bills.some((b) => b.id === bill.id && b.status === 'APPROVED')) return;
      }
      throw new ApiError(0, 'PENDING', 'Your bank is still confirming the top-up. The bill is approved as soon as it does.');
    }, 'Bill approved.');
}
