import { reactive } from '@odoo/owl';
import type { SelfUser } from '@onsite/types';

export type ToastVariant = 'default' | 'success' | 'error';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

export interface AppStore {
  user: SelfUser | null;
  /** True until the initial silent-refresh-from-cookie attempt finishes. */
  isLoading: boolean;
  toasts: Toast[];
}

/**
 * The one shared reactive store. Components subscribe with
 * `this.store = useState(store)`; anything that reads a field during render
 * re-renders when that field changes.
 */
export const store = reactive<AppStore>({
  user: null,
  isLoading: true,
  toasts: [],
});

let nextToastId = 1;
const TOAST_MS = 5000;

export function toast(title: string, options: { description?: string; variant?: ToastVariant } = {}) {
  const id = nextToastId++;
  store.toasts.push({ id, title, description: options.description, variant: options.variant ?? 'default' });
  setTimeout(() => dismissToast(id), TOAST_MS);
  return id;
}

export function dismissToast(id: number) {
  const index = store.toasts.findIndex((t) => t.id === id);
  if (index !== -1) store.toasts.splice(index, 1);
}
