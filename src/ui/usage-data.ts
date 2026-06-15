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

/** v0.8 + v0.9 build session — cumulative through Jun 15 2026.
 *  Source: `claude /usage` output at session close. Update each session. */
export const SESSION_USAGE: SessionUsage = {
  totalCost: 217.72,
  apiDuration: '7h 29m 24s',
  wallDuration: '1d 14h 13m',
  linesAdded: 10768,
  linesRemoved: 1151,
  byModel: [
    {
      model: 'claude-haiku-4-5',
      inputK: 25.8,
      outputK: 68.1,
      cacheReadM: 7.1,
      cacheWriteK: 497.2,
      cost: 1.7,
    },
    {
      model: 'claude-opus-4-8',
      inputK: 210.3,
      outputK: 927.4,
      cacheReadM: 214.1,
      cacheWriteK: 4500,
      cost: 169.55,
    },
    {
      model: 'claude-sonnet-4-6',
      inputK: 33.2,
      outputK: 631.3,
      cacheReadM: 85.8,
      cacheWriteK: 3000,
      cost: 46.48,
    },
  ],
};
