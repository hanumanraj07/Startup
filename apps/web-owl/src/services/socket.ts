import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from './api';

export interface TaskSocketHandlers {
  onMessage?: (message: unknown) => void;
  onStatus?: (event: { taskId: string; status: string }) => void;
}

/**
 * Joins a task's Socket.IO room, per docs/07-api-specification.md's
 * "WebSocket namespace /ws, room per task, membership authorized on
 * connection." The server independently verifies the caller is a party to
 * the task before allowing the join; this can only ask for it.
 *
 * Returns a disposer that leaves the room and closes the socket.
 */
export function joinTaskRoom(taskId: string, handlers: TaskSocketHandlers): () => void {
  const token = getAccessToken();
  if (!token) return () => undefined;

  const socket: Socket = io(`${API_URL}/ws`, {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    socket.emit('task:join', { taskId });
  });
  socket.on('message:new', (message: unknown) => handlers.onMessage?.(message));
  socket.on('task:status', (event: { taskId: string; status: string }) => handlers.onStatus?.(event));

  return () => {
    socket.emit('task:leave', { taskId });
    socket.disconnect();
  };
}
