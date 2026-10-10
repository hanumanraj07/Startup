import { Component, useRef, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { api } from '@/services/api';
import { btn } from '@/ui/classes';

export type KycDocumentKind = 'front' | 'back' | 'selfie';

/** One document picker: presigns, then uploads straight to storage, then hands the storage key to the form. */
export class DocumentUpload extends Component {
  static override template = xml`
    <div class="flex flex-col gap-1.5">
      <input t-ref="file" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" t-on-change="onFileChange"/>
      <button type="button" t-att-class="buttonClass" t-att-disabled="state.uploading" t-att-aria-busy="state.uploading ? 'true' : null"
        t-on-click="pickFile">
        <span t-if="state.uploading" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-ink-900" aria-hidden="true"/>
        <Icon t-elif="props.uploaded" name="'circle-check'" size="16" class="'text-verified'"/>
        <Icon t-else="" name="'upload'" size="16"/>
        <t t-out="label"/>
      </button>
      <p t-if="state.error" role="alert" class="text-xs text-dispute" t-out="state.error"/>
    </div>`;
  static components = { Icon };
  static override props = {
    label: String,
    kind: String,
    uploaded: Boolean,
    onUploaded: Function,
  };

  file = useRef('file');
  state = useState<{ uploading: boolean; error: string | null }>({ uploading: false, error: null });
  buttonClass = btn('secondary', 'default', 'w-full');

  get label(): string {
    return this.props.uploaded ? `${this.props.label} added` : this.props.label;
  }

  pickFile() {
    (this.file.el as HTMLInputElement | null)?.click();
  }

  onFileChange(ev: Event) {
    const target = ev.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void this.upload(file);
    target.value = '';
  }

  private async upload(file: File) {
    this.state.uploading = true;
    this.state.error = null;
    try {
      const presign = await api.post<{ storageKey: string; uploadUrl: string }>('/users/me/kyc/presign', {
        kind: this.props.kind,
        contentType: file.type,
      });
      const res = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!res.ok) throw new Error('Upload failed');
      this.props.onUploaded(presign.storageKey);
    } catch {
      this.state.error = 'Upload failed. Try again.';
    } finally {
      this.state.uploading = false;
    }
  }
}
