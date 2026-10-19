import { onMounted, onWillUnmount } from '@odoo/owl';
import { joinTaskRoom, type TaskRoomHandle, type TaskSocketHandlers } from '@/services/socket';

/**
 * Joins a task's room for the lifetime of the calling component and tears the
 * socket down on unmount. Call from a component's `setup()`. The returned
 * object's `current` is the live room handle once mounted (null before, or
 * when signed out), for components that also send, like location sharing.
 */
export function useTaskSocket(taskId: string, handlers: TaskSocketHandlers): { current: TaskRoomHandle | null } {
  const ref: { current: TaskRoomHandle | null } = { current: null };
  onMounted(() => {
    ref.current = joinTaskRoom(taskId, handlers);
  });
  onWillUnmount(() => {
    ref.current?.leave();
    ref.current = null;
  });
  return ref;
}
