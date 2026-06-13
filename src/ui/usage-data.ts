// Session usage data — PURE DATA: this is updated manually each session from
// the Claude Code CLI `/usage` output. The running web app cannot fetch live
// session stats, so this is a snapshot recorded at session close. Append or
// replace the object to update. Mirrors pipeline-data.ts's "data only, append
// to update" philosophy.

export type ModelUsage = {
  /** Model identifier as shown in the CLI output (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Thousands of input tokens (e.g. 14.3 = 14,300). */
  inputK: number;
  /** Thousands of output tokens. */
  outputK: number;
  /** Millions of cache-read tokens. */
  cacheReadM: number;
  /** Thousands of cache-write tokens. */
  cacheWriteK: number;
  /** USD cost for this model. */
  cost: number;
};

export type SessionUsage = {
  /** Total session cost in USD. */
  totalCost: number;
  /** Total API time (human-readable). */
  apiDuration: string;
  /** Total wall-clock time (human-readable). */
  wallDuration: string;
  /** Lines of code added across the session. */
  linesAdded: number;
  /** Lines of code removed across the session. */
  linesRemoved: number;
  /** Per-model breakdown. */
  byModel: ModelUsage[];
};

/** v0.8 build session — Jun 14 2026.
 *  Source: `claude /usage` output at session close. Update each session. */
export const SESSION_USAGE: SessionUsage = {
  totalCost: 40.08,
  apiDuration: '2h 31m 17s',
  wallDuration: '5h 26m 44s',
  linesAdded: 2951,
  linesRemoved: 257,
  byModel: [
    {
      model: 'claude-haiku-4-5',
      inputK: 21.1,
      outputK: 22.1,
      cacheReadM: 2.9,
      cacheWriteK: 191.5,
      cost: 0.66,
    },
    {
      model: 'claude-opus-4-8',
      inputK: 21.1,
      outputK: 130.3,
      cacheReadM: 7.9,
      cacheWriteK: 651.9,
      cost: 13.84,
    },
    {
      model: 'claude-sonnet-4-6',
      inputK: 14.3,
      outputK: 343.0,
      cacheReadM: 51.5,
      cacheWriteK: 1300,
      cost: 25.58,
    },
  ],
};
