import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { createBullConnection } from '../../queue/redis-connection';

/**
 * docs/05-system-architecture.md: "Socket.IO gateway with the Redis adapter"
 * — without this, a chat message sent to the API replica holding the
 * sender's socket never reaches a recipient whose socket happens to be on a
 * different replica. The adapter fans out `server.to(room).emit(...)` calls
 * through Redis pub/sub so every replica hears every emit regardless of
 * which one issued it.
 *
 * Two dedicated ioredis connections (pub/sub), separate from the BullMQ
 * connection: a client in subscriber mode cannot issue ordinary commands, so
 * it cannot be shared with anything else.
 */
export class SocketRedisAdapter extends IoAdapter {
  constructor(app: INestApplicationContext) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    const pubClient = createBullConnection();
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    return server;
  }
}
