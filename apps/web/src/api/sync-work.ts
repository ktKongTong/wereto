export type SyncStage =
  | "bootstrap"
  | "incremental-week"
  | "incremental-shelf"
  | "shelf"
  | "notebooks"
  | "reading-overall"
  | "reading-periods"
  | "reading-years"
  | "reading-days"
  | "book-details"
  | "notebook-content"
  | "commit";

export type WereadSyncWorkMessage = {
  runId: number;
  stage?: SyncStage;
  offset?: number;
  chunkIndex?: number;
  chunkSize?: number;
  chunkEnd?: number;
  overall?: {
    registTime?: number;
  };
  startYear?: number;
  currentYear?: number;
  mode?: "full" | "incremental";
  result?: Record<string, unknown>;
};

export type WereadSyncQueueMessage = WereadSyncWorkMessage;
