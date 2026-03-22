export const SESSION_STATUSES = [
  "STARTING", "RUNNING", "STOPPING", "COMPLETED", "ERRORED", "TIMED_OUT",
] as const;

export const SESSION_OUTCOMES = [
  "PR_CREATED", "COMMITTED_TO_MAIN", "DISCARDED",
] as const;

export const MESSAGE_ROLES = ["USER", "ASSISTANT", "SYSTEM"] as const;
