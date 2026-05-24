import type {WereadSyncQueueMessage} from "./sync-work.ts";
import {processSyncWork, type WereadSyncWorkerEnv} from "./sync-worker.ts";
import type {RepoCtx} from "@/api/db/repos/ctx.ts";

export async function consumeWereadSyncQueue(batch: MessageBatch<unknown>, env: WereadSyncWorkerEnv) {
  for (const message of batch.messages) {
    const body = parseSyncQueueMessage(message.body);
    await processSyncWork(env, body);
    message.ack();
  }
}

function parseSyncQueueMessage(body: unknown): WereadSyncQueueMessage {
  if (!body || typeof body !== "object" || typeof (body as { runId?: unknown }).runId !== "number") {
    throw new Error("Invalid weread sync queue message");
  }
  return body as WereadSyncQueueMessage;
}

export type WereadSyncDispatchEnv = {
  WEREAD_SYNC_QUEUE: Queue<WereadSyncQueueMessage>;
};

export async function enqueueSyncWork(env: WereadSyncDispatchEnv, message: WereadSyncQueueMessage) {
  await env.WEREAD_SYNC_QUEUE.send(message);
}

export async function enqueueSyncWorks(env: WereadSyncDispatchEnv, messages: WereadSyncQueueMessage[]) {
  if (messages.length === 0) return;
  await env.WEREAD_SYNC_QUEUE.sendBatch(messages.map((body) => ({body})));
}

export async function dispatchNextSyncWork(repos: RepoCtx, env: WereadSyncDispatchEnv, message: WereadSyncQueueMessage) {
  await enqueueSyncWork(env, message);
  await repos.runs.markQueuePending(message.runId);
}

export async function dispatchSyncWorks(repos: RepoCtx, env: WereadSyncDispatchEnv, runId: number, messages: WereadSyncQueueMessage[]) {
  await enqueueSyncWorks(env, messages);
  await repos.runs.markQueuePending(runId);
}