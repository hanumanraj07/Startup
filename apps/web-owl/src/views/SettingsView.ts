import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Page } from '@/components/Page';
import { TextField } from '@/components/TextField';
import { navigate } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { logout, refetchUser } from '@/services/session';
import { store, toast } from '@/store/store';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, LABEL } from '@/ui/classes';

interface WorkerSettings {
  workingRadiusMeters: number;
  baseCity: string;
}

interface SettingsState {
  displayName: string;
  savingProfile: boolean;
  profileError: string | null;
  worker: WorkerSettings | null;
  radiusKm: number;
  savingRadius: boolean;
  deleteOpen: boolean;
  confirmText: string;
  password: string;
  deleting: boolean;
  deleteError: string | null;
}

/** Profile name, the worker's travel radius, and account deletion behind a typed confirmation. */
export class SettingsView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Settings' }]">
      <div class="mx-auto flex max-w-2xl flex-col gap-4">
        <section t-att-class="cardClass">
          <div class="${CARD_HEADER}"><h2 class="${CARD_TITLE}">Profile</h2></div>
          <div class="${CARD_CONTENT} flex flex-col gap-3">
            <TextField id="'displayName'" label="'Display name'" maxlength="80"
              value="state.displayName" onInput="setDisplayName"/>
            <p t-if="state.profileError" role="alert" class="text-sm text-dispute" t-out="state.profileError"/>
            <button type="button" t-att-class="saveClass" t-att-disabled="!canSaveProfile or state.savingProfile" t-on-click="saveProfile">
              Save
            </button>
          </div>
        </section>

        <section t-if="user and user.hasWorkerProfile" t-att-class="cardClass">
          <div class="${CARD_HEADER}">
            <h2 class="${CARD_TITLE}">Worker settings</h2>
            <p class="${CARD_DESCRIPTION}">How far you’re willing to travel from <t t-out="baseCity"/> for a task.</p>
          </div>
          <div class="${CARD_CONTENT} flex flex-col gap-3">
            <p t-if="!state.worker" class="text-sm text-ink-500">Loading…</p>
            <t t-else="">
              <div class="flex flex-col gap-1.5">
                <label for="radius" class="${LABEL}">Working radius: <t t-out="state.radiusKm"/> km</label>
                <input id="radius" type="range" min="1" max="50" t-att-value="state.radiusKm" class="w-full accent-brand-600" t-on-input="onRadius"/>
              </div>
              <p class="text-xs text-ink-400">Wider covers more tasks but means more travel. Most workers do well between 10–20 km.</p>
              <button type="button" t-att-class="saveClass" t-att-disabled="state.savingRadius" t-on-click="saveRadius">Save</button>
            </t>
          </div>
        </section>

        <section t-att-class="dangerClass">
          <div class="${CARD_HEADER}">
            <h2 class="flex items-center gap-2 text-lg font-medium text-dispute">
              <Icon name="'alert-triangle'" size="20"/> Danger zone
            </h2>
            <p class="${CARD_DESCRIPTION}">Permanently delete your account. This cannot be undone.</p>
          </div>
          <div class="${CARD_CONTENT}">
            <button type="button" t-att-class="destructiveSmClass" t-on-click="openDelete">Delete my account</button>
          </div>
        </section>
      </div>

      <Modal open="state.deleteOpen" onClose="closeDelete" title="'Delete your account?'"
        description="'Your name, email, and phone number are permanently erased. Task and payment history is kept (anonymized) since other people’s records depend on it. This cannot be undone. If you have any task still in progress, finish or cancel it first.'">
        <div class="flex flex-col gap-3">
          <TextField id="'confirmDelete'" label="'Type &quot;DELETE&quot; to confirm'"
            value="state.confirmText" onInput="setConfirmText"/>
          <TextField id="'deletePassword'" label="'Password (leave blank if you use Google sign-in)'" type="'password'"
            autocomplete="'current-password'" value="state.password" onInput="setPassword"/>
          <p t-if="state.deleteError" role="alert" class="text-sm text-dispute" t-out="state.deleteError"/>
        </div>
        <t t-set-slot="footer">
          <button type="button" t-att-class="cancelClass" t-on-click="closeDelete">Cancel</button>
          <button type="button" t-att-class="destructiveClass" t-att-disabled="state.confirmText !== 'DELETE' or state.deleting"
            t-on-click="deleteAccount">Permanently delete</button>
        </t>
      </Modal>
    </Page>`;
  static components = { Icon, Modal, Page, TextField };
  static override props = {};

  store = useState(store);
  state = useState<SettingsState>({
    displayName: store.user?.displayName ?? '',
    savingProfile: false,
    profileError: null,
    worker: null,
    radiusKm: 10,
    savingRadius: false,
    deleteOpen: false,
    confirmText: '',
    password: '',
    deleting: false,
    deleteError: null,
  });

  cardClass = card();
  dangerClass = card('border-dispute/30');
  saveClass = btn('primary', 'sm', 'self-start');
  cancelClass = btn('secondary');
  destructiveClass = btn('destructive');
  destructiveSmClass = btn('destructive', 'sm');

  private disposed = false;

  override setup() {
    onMounted(() => {
      if (this.store.user?.hasWorkerProfile) void this.loadWorker();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  get user() {
    return this.store.user;
  }

  get baseCity(): string {
    return this.state.worker?.baseCity ?? 'your base location';
  }

  get canSaveProfile(): boolean {
    return this.state.displayName.trim().length >= 2;
  }

  setDisplayName = (v: string) => {
    this.state.displayName = v;
  };

  setConfirmText = (v: string) => {
    this.state.confirmText = v;
  };

  setPassword = (v: string) => {
    this.state.password = v;
  };

  onRadius = (ev: Event) => {
    this.state.radiusKm = Number((ev.target as HTMLInputElement).value);
  };

  private async loadWorker() {
    try {
      const worker = await api.get<WorkerSettings>('/workers/me');
      if (this.disposed) return;
      this.state.worker = worker;
      this.state.radiusKm = Math.round(worker.workingRadiusMeters / 1000);
    } catch {
      // The section stays on "Loading…"; the rest of the page still works.
    }
  }

  saveProfile = async () => {
    const { state } = this;
    state.savingProfile = true;
    state.profileError = null;
    try {
      await api.patch('/users/me', { displayName: state.displayName.trim() });
      await refetchUser();
      toast('Profile saved', { variant: 'success' });
    } catch (error) {
      state.profileError = error instanceof ApiError ? error.message : 'Could not save your name.';
    } finally {
      state.savingProfile = false;
    }
  };

  saveRadius = async () => {
    const { state } = this;
    state.savingRadius = true;
    try {
      await api.patch('/workers/me', { workingRadiusMeters: state.radiusKm * 1000 });
      toast('Working radius saved', { variant: 'success' });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save your radius.', { variant: 'error' });
    } finally {
      state.savingRadius = false;
    }
  };

  openDelete = () => {
    this.state.deleteOpen = true;
  };

  closeDelete = () => {
    const { state } = this;
    state.deleteOpen = false;
    state.confirmText = '';
    state.password = '';
    state.deleteError = null;
  };

  deleteAccount = async () => {
    const { state } = this;
    state.deleting = true;
    state.deleteError = null;
    try {
      await api.delete('/users/me', { confirm: state.confirmText, password: state.password || undefined });
      await logout();
      navigate('/sign-in');
    } catch (error) {
      state.deleteError = error instanceof ApiError ? error.message : 'Could not delete your account.';
      state.deleting = false;
    }
  };
}
