import { syncWereadToDb } from "./sync-weread.ts";

export type WereadSyncQueueMessage = {
  type: "weread_sync";
  runId: number;
};

export type WereadSyncQueueEnv = {
  DB: D1Database;
  WEREAD_SYNC_QUEUE: Queue<WereadSyncQueueMessage>;
};

export async function consumeWereadSyncQueue(
  batch: MessageBatch<WereadSyncQueueMessage>,
  env: Pick<WereadSyncQueueEnv, "DB">,
) {
  for (const message of batch.messages) {
    try {
      if (message.body.type !== "weread_sync") {
        message.ack();
        continue;
      }

      await syncWereadToDb({ DB: env.DB }, message.body.runId);
      message.ack();
    } catch (error) {
      console.error("Weread sync queue failed", error);
      // syncWereadToDb already records failed status and logs. Ack here to
      // avoid retrying the same run forever with duplicated phase logs.
      message.ack();
    }
  }
}
