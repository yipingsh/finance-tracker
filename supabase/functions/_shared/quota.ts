import { admin } from "./supabase.ts";

export type Reservation = { runId: string; uploadsUsed: number; uploadsLimit: number };

// Database error codes from reserve_upload -> HTTP status + message for the user.
const REJECTIONS: Record<string, { status: number; message: string }> = {
  monthly_quota_exceeded: { status: 429, message: "You've used all your uploads for this month." },
  global_daily_cap_reached: {
    status: 503,
    message: "The app has reached its daily processing budget. Please try again tomorrow.",
  },
  run_in_progress: { status: 409, message: "A statement is already being processed. Wait for it to finish." },
};

export class QuotaRejected extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

export async function reserveUpload(userId: string, estimatedUsd: number): Promise<Reservation> {
  return reserveRun(userId, "upload", estimatedUsd);
}

/** Reserves one run of the given kind against its monthly limit and the global daily cap. */
export async function reserveRun(userId: string, kind: "upload" | "insight", estimatedUsd: number): Promise<Reservation> {
  const { data, error } = await admin.rpc("reserve_run", {
    p_user_id: userId,
    p_kind: kind,
    p_estimated_usd: estimatedUsd,
  }).single<{ run_id: string; used: number; monthly_limit: number }>();
  if (error) {
    const rejection = REJECTIONS[error.message];
    if (rejection) {
      const message = kind === "insight" && error.message === "monthly_quota_exceeded"
        ? "You've used all your monthly summaries for this month."
        : rejection.message;
      throw new QuotaRejected(error.message, rejection.status, message);
    }
    throw error;
  }
  return { runId: data.run_id, uploadsUsed: data.used, uploadsLimit: data.monthly_limit };
}

export async function finishRun(runId: string, actualUsd: number, succeeded: boolean): Promise<void> {
  const { error } = await admin.rpc("finish_run", {
    p_run_id: runId,
    p_actual_usd: actualUsd,
    p_succeeded: succeeded,
  });
  if (error) throw error;
}
