import { Component, useState, xml } from '@odoo/owl';
import { payoutAccountSchema } from '@onsite/validation';
import { Tabs } from '@/components/Tabs';
import { TextField } from '@/components/TextField';
import type { PayoutAccountView } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { btn } from '@/ui/classes';

type Kind = 'BANK' | 'UPI';
type Field = 'accountHolderName' | 'accountNumber' | 'confirmAccountNumber' | 'ifsc' | 'upiVpa' | 'panNumber';

/**
 * Adds a bank account or UPI ID for payouts. Checked here with the same
 * schema the API applies, so mistakes show against the field before anything
 * is sent; the account number is typed twice because a wrong digit sends money
 * to a stranger. The API keeps only the last four digits and encrypts the PAN.
 */
export class PayoutAccountForm extends Component {
  static override template = xml`
    <form class="flex flex-col gap-4" t-on-submit.prevent="submit" novalidate="">
      <Tabs tabs="kinds" value="state.kind" onChange="setKind"/>

      <t t-if="state.kind === 'BANK'">
        <TextField id="'holder'" label="'Account holder name'" autocomplete="'name'"
          hint="'Exactly as on your passbook or cheque.'" error="state.errors.accountHolderName"
          value="state.values.accountHolderName" onInput="(v) => set('accountHolderName', v)"/>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField id="'account'" label="'Account number'" type="'password'" autocomplete="'off'"
            error="state.errors.accountNumber"
            value="state.values.accountNumber" onInput="(v) => set('accountNumber', v)"/>
          <TextField id="'confirm'" label="'Re-enter account number'" autocomplete="'off'"
            error="state.errors.confirmAccountNumber"
            value="state.values.confirmAccountNumber" onInput="(v) => set('confirmAccountNumber', v)"/>
        </div>
        <TextField id="'ifsc'" label="'IFSC'" placeholder="'e.g. HDFC0001234'" maxlength="11"
          hint="'11 characters, printed on your cheque book.'" error="state.errors.ifsc"
          value="state.values.ifsc" onInput="(v) => set('ifsc', v)"/>
      </t>
      <TextField t-else="" id="'upi'" label="'UPI ID'" placeholder="'e.g. rahul@okhdfcbank'" autocomplete="'off'"
        error="state.errors.upiVpa"
        value="state.values.upiVpa" onInput="(v) => set('upiVpa', v)"/>

      <TextField id="'pan'" label="'PAN'" placeholder="'ABCDE1234F'" maxlength="10"
        hint="'Needed for tax records on what you earn. Stored encrypted and never shown again.'" error="state.errors.panNumber"
        value="state.values.panNumber" onInput="(v) => set('panNumber', v)"/>

      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
      <div class="flex flex-wrap gap-2">
        <button type="submit" t-att-class="submitClass" t-att-disabled="state.busy" t-att-aria-busy="state.busy ? 'true' : null">
          Save account
        </button>
        <button type="button" t-att-class="cancelClass" t-att-disabled="state.busy" t-on-click="props.onCancel">Cancel</button>
      </div>
    </form>`;
  static components = { Tabs, TextField };
  static override props = { onAdded: Function, onCancel: Function };

  kinds = [
    { value: 'BANK', label: 'Bank account' },
    { value: 'UPI', label: 'UPI ID' },
  ];
  submitClass = btn('primary');
  cancelClass = btn('ghost');

  state = useState<{
    kind: Kind;
    values: Record<Field, string>;
    errors: Partial<Record<Field, string>>;
    busy: boolean;
    error: string | null;
  }>({
    kind: 'BANK',
    values: { accountHolderName: '', accountNumber: '', confirmAccountNumber: '', ifsc: '', upiVpa: '', panNumber: '' },
    errors: {},
    busy: false,
    error: null,
  });

  setKind = (kind: string) => {
    this.state.kind = kind as Kind;
    this.state.errors = {};
    this.state.error = null;
  };

  set = (field: Field, value: string) => {
    this.state.values[field] = value;
    if (this.state.errors[field]) this.state.errors[field] = undefined;
  };

  /** The request body, or null with the errors set against each field. */
  private validate(): Record<string, string> | null {
    const v = this.state.values;
    const body =
      this.state.kind === 'BANK'
        ? {
            type: 'BANK',
            accountHolderName: v.accountHolderName.trim(),
            accountNumber: v.accountNumber.replace(/\s+/g, ''),
            ifsc: v.ifsc.trim().toUpperCase(),
            panNumber: v.panNumber.trim().toUpperCase(),
          }
        : { type: 'UPI', upiVpa: v.upiVpa.trim(), panNumber: v.panNumber.trim().toUpperCase() };

    const errors: Partial<Record<Field, string>> = {};
    const parsed = payoutAccountSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = (issue.path[0] as Field | undefined) ?? (this.state.kind === 'BANK' ? 'accountHolderName' : 'upiVpa');
        errors[field] ??= issue.message;
      }
    }
    if (this.state.kind === 'BANK') {
      if (!body.accountHolderName) errors.accountHolderName ??= 'Enter the name on the account';
      if (!body.ifsc) errors.ifsc ??= 'Enter a valid IFSC code';
      if (!body.accountNumber) errors.accountNumber ??= 'Enter the 9 to 18 digit account number';
      if (v.confirmAccountNumber.replace(/\s+/g, '') !== body.accountNumber) {
        errors.confirmAccountNumber = 'The two account numbers do not match';
      }
    }
    this.state.errors = errors;
    return Object.keys(errors).length === 0 ? (body as unknown as Record<string, string>) : null;
  }

  async submit() {
    const body = this.validate();
    if (!body) return;
    this.state.busy = true;
    this.state.error = null;
    try {
      const account = await api.post<PayoutAccountView>('/users/me/payout-accounts', body);
      await this.props.onAdded(account);
    } catch (error) {
      this.state.error = error instanceof ApiError ? error.message : 'Could not save the account. Try again.';
    } finally {
      this.state.busy = false;
    }
  }
}
