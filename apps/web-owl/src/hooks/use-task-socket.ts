import { onWillUnmount, onMounted } from '@odoo/owl';
import { joinTaskRoom, type TaskSocketHandlers } from '@/services/socket';

/**
 * Joins a task's room for the lifetime of the calling component and tears the
 * socket down on unmount. Call from a component's `setup()`.
 */
export function useTaskSocket(taskId: string, handlers: TaskSocketHandlers) {
  let dispose: (() => void) | null = null;
  onMounted(() => {
    dispose = joinTaskRoom(taskId, handlers);
  });
  onWillUnmount(() => {
    dispose?.();
    dispose = null;
  });
}
