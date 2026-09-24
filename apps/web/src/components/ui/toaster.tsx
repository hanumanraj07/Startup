'use client';

import { useToasts } from '@/lib/use-toast';
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from './toast';

/**
 * Mounted once in the root layout. Every `toast(...)` call (from
 * `@/lib/use-toast`) renders here, wherever the call site is in the tree.
 */
export function Toaster() {
  const { toasts, dismiss } = useToasts();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, variant }) => (
        <Toast key={id} variant={variant} onOpenChange={(open) => !open && dismiss(id)}>
          <div className="flex-1">
            <ToastTitle>{title}</ToastTitle>
            {description ? <ToastDescription>{description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
