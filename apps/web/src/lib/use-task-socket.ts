'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from './api-client';

interface TaskSocketHandlers {
  onMessage?: (message: unknown) => void;
  onStatus?: (event: { taskId: string; status: string }) => void;
}

/**
 * Joins a task's Socket.IO room for the lifetime of the component, per
 * docs/07-api-specification.md's "WebSocket namespace /ws, room per task,
 * membership authorized on connection." The server independently verifies
 * the caller is actually a party to this task before allowing the join, so
 * this hook cannot itself grant access to a room — only ask for it.
 */
export function useTaskSocket(taskId: string | undefined, handlers: TaskSocketHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!taskId) return;
    const token = getAccessToken();
    if (!token) return;

    const socket: Socket = io(`${API_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      socket.emit('task:join', { taskId });
    });
    socket.on('message:new', (message: unknown) => handlersRef.current.onMessage?.(message));
    socket.on('task:status', (event: { taskId: string; status: string }) => handlersRef.current.onStatus?.(event));

    return () => {
      socket.emit('task:leave', { taskId });
      socket.disconnect();
    };
  }, [taskId]);
}
