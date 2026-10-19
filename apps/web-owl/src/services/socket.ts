import { io, type Socket } from 'socket.io-client';
import { config } from '@/lib/config';
import { getAccessToken } from './api';

/** The worker's shared position, as the server re-broadcasts it (distance measured server-side). */
export interface LiveLocationEvent {
  taskId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  heading: number | null;
  at: string;
  leg: 'to_task' | 'to_pickup' | 'to_dropoff';
  distanceMeters: number;
}

export interface TaskSocketHandlers {
  onMessage?: (message: unknown) => void;
  onStatus?: (event: { taskId: string; status: string }) => void;
  onLocation?: (event: LiveLocationEvent) => void;
  onLocationEnded?: () => void;
  /** Connected (true) or lost (false), so a screen can say "reconnecting". */
  onConnection?: (connected: boolean) => void;
}

export interface TaskRoomHandle {
  /** Sends the worker's position; dropped silently while disconnected, since only the newest point matters. */
  sendLocation(position: { latitude: number; longitude: number; accuracyMeters?: number; heading?: number; speed?: number }): void;
  connected(): boolean;
  leave(): void;
}

/**
 * The token is read on every (re)connect, not captured once: access tokens
 * last 15 minutes, and a socket that reconnects after a network drop with a
 * stale one would be refused.
 */
function connect(): Socket {
  return io(`${config.socketUrl}/ws`, {
    auth: (cb) => cb({ token: getAccessToken() }),
    transports: ['websocket'],
  });
}

/**
 * Joins a task's Socket.IO room, per docs/07-api-specification.md's
 * "WebSocket namespace /ws, room per task, membership authorized on
 * connection." The server independently verifies the caller is a party to
 * the task before allowing the join; this can only ask for it.
 */
export function joinTaskRoom(taskId: string, handlers: TaskSocketHandlers): TaskRoomHandle | null {
  if (!getAccessToken()) return null;
  const socket = connect();

  socket.on('connect', () => {
    socket.emit('task:join', { taskId });
    handlers.onConnection?.(true);
  });
  socket.on('disconnect', () => handlers.onConnection?.(false));
  socket.on('message:new', (message: unknown) => handlers.onMessage?.(message));
  socket.on('task:status', (event: { taskId: string; status: string }) => handlers.onStatus?.(event));
  socket.on('location:worker', (event: LiveLocationEvent) => {
    if (event.taskId === taskId) handlers.onLocation?.(event);
  });
  socket.on('location:ended', (event: { taskId: string }) => {
    if (event.taskId === taskId) handlers.onLocationEnded?.();
  });

  return {
    sendLocation(position) {
      // volatile: never queued for later. A stale point delivered after a
      // reconnect would make the worker appear to jump backwards.
      socket.volatile.emit('location:update', { taskId, ...position });
    },
    connected: () => socket.connected,
    leave() {
      socket.emit('task:leave', { taskId });
      socket.disconnect();
    },
  };
}

// ─── The signed-in user's own socket ─────────────────────────────────────

type SessionEvent = 'offer:new' | 'offer:closed' | 'task:assigned';
type Listener = (payload: unknown) => void;

let session: Socket | null = null;
const listeners = new Map<SessionEvent, Set<Listener>>();
const reconnectListeners = new Set<() => void>();

/**
 * One socket per signed-in session for events addressed to the user rather
 * than a task: incoming task requests for a worker, and "your task was
 * accepted" for a requester. The server puts every authenticated socket in
 * its user's room; nothing here asks for it.
 */
export function startSessionSocket(): void {
  if (session || !getAccessToken()) return;
  session = connect();
  for (const event of ['offer:new', 'offer:closed', 'task:assigned'] as const) {
    session.on(event, (payload: unknown) => listeners.get(event)?.forEach((fn) => fn(payload)));
  }
  // Anything sent while the connection was down is re-read from the API.
  session.io.on('reconnect', () => reconnectListeners.forEach((fn) => fn()));
}

export function stopSessionSocket(): void {
  session?.disconnect();
  session = null;
}

export function onSessionEvent(event: SessionEvent, fn: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)?.add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function onSessionReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}
