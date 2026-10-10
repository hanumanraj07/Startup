import { Component, useRef, useState, xml } from '@odoo/owl';
import type { ProofRequirement } from '@/lib/api-types';
import { ApiError, api } from '@/services/api';
import { getPosition } from '@/services/geo';
import { btn, input } from '@/ui/classes';

/** Captures one proof requirement: a photo/video upload, a structured field, or a note. */
export class RequirementCapture extends Component {
  static override template = xml`
    <div t-if="isMedia" class="flex items-center gap-2">
      <input t-ref="file" type="file" t-att-accept="accept" class="hidden" t-on-change="onFileChange"/>
      <button type="button" t-att-class="secondaryClass" t-att-disabled="props.disabled or state.uploading" t-on-click="pickFile">
        <span t-if="state.uploading" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-ink-700" aria-hidden="true"/>
        Add <t t-out="mediaLabel"/>
      </button>
    </div>
    <div t-elif="props.requirement.type === 'STRUCTURED_FIELD'" class="flex items-center gap-2">
      <input t-att-class="fieldClass" t-att-placeholder="props.requirement.label" t-att-aria-label="props.requirement.label" t-model="state.text"/>
      <button type="button" t-att-class="secondaryClass" t-att-disabled="props.disabled or !state.text.trim()" t-on-click="saveField">Save</button>
    </div>
    <div t-elif="props.requirement.type === 'NOTE'" class="flex flex-col gap-2">
      <textarea t-att-class="textareaClass" rows="2" t-att-placeholder="props.requirement.label" t-att-aria-label="props.requirement.label" t-model="state.text"/>
      <button type="button" t-att-class="secondaryClass" t-att-disabled="props.disabled or !state.text.trim()" t-on-click="saveNote">Save note</button>
    </div>
    <p t-else="" class="text-sm text-ink-400"><t t-out="props.requirement.label"/>: capture not supported yet.</p>`;
  static override props = {
    taskId: String,
    requirement: Object,
    disabled: Boolean,
    onCapture: Function,
    onError: Function,
  };

  file = useRef('file');
  state = useState({ uploading: false, text: '' });

  secondaryClass = btn('secondary', 'sm');
  fieldClass = input(false, 'max-w-xs');
  textareaClass = input(false, 'min-h-[64px] py-2');

  get requirement(): ProofRequirement {
    return this.props.requirement as ProofRequirement;
  }

  get isMedia(): boolean {
    return this.requirement.type === 'PHOTO' || this.requirement.type === 'VIDEO';
  }

  get accept(): string {
    return this.requirement.type === 'PHOTO'
      ? 'image/jpeg,image/png,image/webp'
      : 'video/mp4,video/quicktime,video/webm';
  }

  get mediaLabel(): string {
    return this.requirement.label.toLowerCase();
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

  /** Presign, then upload straight to storage, then record the proof with the device position as evidence. */
  private async upload(file: File) {
    this.state.uploading = true;
    try {
      const position = await getPosition();
      const presign = await api.post<{ storageKey: string; uploadUrl: string }>(
        `/tasks/${this.props.taskId}/proofs/presign`,
        { type: this.requirement.type, contentType: file.type, sizeBytes: file.size },
      );
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      // Recording a proof for an upload that failed would put a dead file in front of the reviewer.
      if (!put.ok) throw new Error('The upload did not complete.');
      this.props.onCapture({
        type: this.requirement.type,
        storageKey: presign.storageKey,
        capturedAt: new Date().toISOString(),
        ...(position
          ? {
              location: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracyMeters: position.coords.accuracy,
              },
            }
          : {}),
      });
    } catch (error) {
      this.props.onError(error instanceof ApiError ? error.message : 'Could not upload that file. Try again.');
    } finally {
      this.state.uploading = false;
    }
  }

  saveField() {
    this.props.onCapture({
      type: 'STRUCTURED_FIELD',
      fieldKey: this.requirement.fieldKey,
      fieldValue: this.state.text.trim(),
    });
    this.state.text = '';
  }

  saveNote() {
    this.props.onCapture({ type: 'NOTE', noteBody: this.state.text.trim() });
    this.state.text = '';
  }
}
