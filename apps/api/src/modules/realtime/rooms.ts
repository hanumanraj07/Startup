/** Socket.IO room names, in one place so the gateway and the publisher can never disagree. */

/** Everyone who is party to a task: its requester and its assigned worker. Joined on request, after an authorization check. */
export function taskRoom(taskId: string): string {
  return `task:${taskId}`;
}

/** One user's own sockets, on any device. Joined automatically on an authenticated connection. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
