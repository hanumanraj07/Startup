import type { Prisma } from '@prisma/client';

type StatsClient = Pick<Prisma.TransactionClient, 'workerProfile'>;
type StatsPrisma = StatsClient & {
  $transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R>;
};

/**
 * Adjusts a worker's task counters and recomputes their completion rate,
 * without losing an update to a concurrent one (docs/22, #20). The counters
 * used to be read, changed in code and written back, so two tasks completing
 * for one worker at the same moment counted once, and the completion rate,
 * which feeds matching scores, drifted.
 *
 * The increment is an atomic UPDATE, which also locks the row until the
 * transaction commits; the rate is then computed from the row as this
 * transaction now sees it. A concurrent adjustment waits for the lock and
 * sees these counts, so both land and the rate is exact.
 *
 * Pass a transaction client to take part in the caller's transaction, or
 * the Prisma service to run in one of its own. A worker with no profile is
 * left alone.
 */
export async function adjustWorkerStats(
  client: StatsPrisma | Prisma.TransactionClient,
  workerId: string,
  delta: { completed?: number; accepted?: number; abandoned?: number },
): Promise<void> {
  const run = async (tx: StatsClient) => {
    const moved = await tx.workerProfile.updateMany({
      where: { userId: workerId },
      data: {
        ...(delta.completed && { tasksCompleted: { increment: delta.completed } }),
        ...(delta.accepted && { tasksAccepted: { increment: delta.accepted } }),
        ...(delta.abandoned && { tasksAbandoned: { increment: delta.abandoned } }),
      },
    });
    if (moved.count === 0) return;
    const profile = await tx.workerProfile.findUnique({
      where: { userId: workerId },
      select: { tasksAccepted: true, tasksCompleted: true },
    });
    if (!profile) return;
    const tasksAccepted = Math.max(0, profile.tasksAccepted);
    await tx.workerProfile.update({
      where: { userId: workerId },
      data: {
        tasksAccepted,
        completionRate: tasksAccepted > 0 ? Math.round((profile.tasksCompleted / tasksAccepted) * 1000) / 10 : null,
      },
    });
  };

  if ('$transaction' in client && typeof client.$transaction === 'function') {
    await (client as StatsPrisma).$transaction((tx) => run(tx));
  } else {
    await run(client as StatsClient);
  }
}
