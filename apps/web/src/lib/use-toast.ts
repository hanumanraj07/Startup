'use client';

import * as React from 'react';

/**
 * A minimal toast store, module-scoped so `toast(...)` can be called from any
 * event handler (a button's onClick, an async submit) without needing a hook
 * in scope — the same shape as shadcn/ui's toast, trimmed to what this app
 * actually needs: title, description, a variant, and auto-dismiss.
 */

export type ToastVariant = 'default' | 'success' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
}

type ToastInput = Omit<ToastItem, 'id'>;

const DEFAULT_DURATION_MS = 4000;

let toasts: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(input: ToastInput) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, ...input }];
  emit();
  window.setTimeout(() => dismiss(id), DEFAULT_DURATION_MS);
  return id;
}

export function useToasts() {
  const [items, setItems] = React.useState<ToastItem[]>(toasts);

  React.useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  return { toasts: items, dismiss };
}
