import { Component, onMounted, onWillUnmount, useEffect, useRef, xml } from '@odoo/owl';

/**
 * A modal dialog on the native <dialog> element, which supplies the focus
 * trap, Escape handling and backdrop for free. Controlled: the parent owns
 * `open`; Escape and backdrop clicks call `onClose` so it can update it.
 * Slots: default (body) and footer (actions).
 */
export class Modal extends Component {
  static override template = xml`
    <dialog
      t-ref="dialog"
      class="w-full max-w-md rounded-card border border-line bg-paper-0 p-0 shadow-float backdrop:bg-ink-900/40"
      t-on-click="onBackdropClick"
    >
      <div class="p-6">
        <h2 class="text-lg font-medium text-ink-900" t-out="props.title"/>
        <p t-if="props.description" class="mt-1 text-sm text-ink-500" t-out="props.description"/>
        <div class="mt-4"><t t-slot="default"/></div>
        <div class="mt-6 flex justify-end gap-3"><t t-slot="footer"/></div>
      </div>
    </dialog>`;
  static override props = {
    open: Boolean,
    onClose: Function,
    title: String,
    description: { type: String, optional: true },
    slots: { type: Object, optional: true },
  };

  dialog = useRef('dialog');

  /**
   * `close` does not bubble, and OWL's `t-on-close` did not receive it from a
   * <dialog>, so the listener is attached to the element directly. Without
   * it, Escape would close the dialog while the parent still believed it was
   * open, and the next "open" would then be a no-op.
   */
  private handleClose = () => {
    if (this.props.open) this.props.onClose();
  };

  override setup() {
    onMounted(() => this.dialog.el?.addEventListener('close', this.handleClose));
    onWillUnmount(() => this.dialog.el?.removeEventListener('close', this.handleClose));

    useEffect(
      (open: boolean) => {
        const el = this.dialog.el as HTMLDialogElement | null;
        if (!el) return;
        if (open && !el.open) el.showModal();
        else if (!open && el.open) el.close();
      },
      () => [this.props.open],
    );
  }

  onBackdropClick(ev: MouseEvent) {
    if (ev.target === this.dialog.el) this.props.onClose();
  }
}
