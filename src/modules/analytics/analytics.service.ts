import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AnalyticsRangeDto } from './dto';

export interface ResolvedRange {
  from: Date;
  to: Date;
}

/**
 * Conversation, handoff and cost metrics (master plan §45).
 *
 * Every figure is computed in SQL against the live tables rather than from a
 * rollup: at MVP volume the aggregate is milliseconds, and a rollup would be
 * a second source of truth that can silently drift. Introduce one when the
 * query actually becomes slow, not before.
 */
@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Turns the query into a concrete window.
   *
   * When `from` is omitted, the start snaps back to midnight UTC rather than
   * subtracting a rolling `days * 24h`. A rolling window straddles one more
   * calendar day than it names — "last 7 days" would draw 8 bars, with a
   * partial day at *each* end, and the two stubs invite the reader to
   * conclude traffic is collapsing. Snapping yields exactly `days` buckets
   * with only today partial.
   *
   * An explicit `from`/`to` is passed through untouched: a caller who names
   * the boundaries means them.
   */
  resolveRange(query: AnalyticsRangeDto): ResolvedRange {
    const to = query.to ? new Date(query.to) : new Date();

    if (query.from) {
      return { from: new Date(query.from), to };
    }

    const startOfToDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    const from = new Date(startOfToDay - (query.days - 1) * 24 * 60 * 60 * 1000);

    return { from, to };
  }

  /**
   * Conversation, resolution and handoff metrics.
   *
   * **On "AI resolved"**: a conversation counts as AI-resolved when it
   * reached CLOSED without ever recording a handoff reason — the AI carried
   * it to the end without calling for a person.
   *
   * Two caveats worth knowing before quoting the number. Closing is a manual
   * act, so the rate only reflects conversations someone actually closed;
   * abandoned ones sit open forever and are counted nowhere. And mode
   * transitions are not journalled, so a conversation handed off and later
   * returned to AI still carries its handoff_reason and reads as not
   * AI-resolved — the metric errs low, which is the safer direction for a
   * number used to argue the AI is working.
   */
  async overview(organizationId: string, range: ResolvedRange) {
    const [conversations] = await this.dataSource.query(
      `SELECT
         count(*)::int                                                          AS total,
         count(*) FILTER (WHERE mode = 'AI')::int                               AS ai_mode,
         count(*) FILTER (WHERE mode = 'HUMAN')::int                            AS human_mode,
         count(*) FILTER (WHERE status = 'OPEN')::int                           AS open,
         count(*) FILTER (WHERE status = 'PENDING')::int                        AS pending,
         count(*) FILTER (WHERE status = 'CLOSED')::int                         AS closed,
         count(*) FILTER (WHERE handoff_reason IS NOT NULL)::int                AS handed_off,
         count(*) FILTER (WHERE status = 'CLOSED'
                            AND handoff_reason IS NULL)::int                    AS ai_resolved
       FROM conversations
       WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3`,
      [organizationId, range.from, range.to],
    );

    const [messages] = await this.dataSource.query(
      `SELECT
         count(*)::int                                          AS total,
         count(*) FILTER (WHERE sender_type = 'CUSTOMER')::int   AS from_customer,
         count(*) FILTER (WHERE sender_type = 'AI')::int         AS from_ai,
         count(*) FILTER (WHERE sender_type = 'ADMIN')::int      AS from_admin
       FROM messages
       WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3`,
      [organizationId, range.from, range.to],
    );

    /**
     * First response time.
     *
     * LATERAL rather than a self-join with GROUP BY: it stops at the first
     * matching reply per customer message instead of scanning every later
     * message and aggregating, which is both faster and easier to read.
     */
    const [responseTime] = await this.dataSource.query(
      `SELECT
         avg(EXTRACT(EPOCH FROM (reply.created_at - m.created_at)))::float      AS avg_seconds,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (reply.created_at - m.created_at))
         )::float                                                               AS median_seconds,
         count(*)::int                                                          AS sampled
       FROM messages m
       CROSS JOIN LATERAL (
         SELECT r.created_at
           FROM messages r
          WHERE r.conversation_id = m.conversation_id
            AND r.created_at > m.created_at
            AND r.sender_type IN ('AI', 'ADMIN')
          ORDER BY r.created_at
          LIMIT 1
       ) AS reply
       WHERE m.organization_id = $1
         AND m.sender_type = 'CUSTOMER'
         AND m.created_at >= $2 AND m.created_at < $3`,
      [organizationId, range.from, range.to],
    );

    const [duration] = await this.dataSource.query(
      `SELECT avg(EXTRACT(EPOCH FROM (closed_at - created_at)))::float AS avg_seconds,
              count(*)::int                                            AS sampled
         FROM conversations
        WHERE organization_id = $1
          AND closed_at IS NOT NULL
          AND created_at >= $2 AND created_at < $3`,
      [organizationId, range.from, range.to],
    );

    const handoffReasons = await this.dataSource.query(
      `SELECT handoff_reason AS reason, count(*)::int AS count
         FROM conversations
        WHERE organization_id = $1
          AND handoff_reason IS NOT NULL
          AND created_at >= $2 AND created_at < $3
        GROUP BY handoff_reason
        ORDER BY count DESC`,
      [organizationId, range.from, range.to],
    );

    const total = conversations.total;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      conversations: {
        total,
        aiMode: conversations.ai_mode,
        humanMode: conversations.human_mode,
        open: conversations.open,
        pending: conversations.pending,
        closed: conversations.closed,
        handedOff: conversations.handed_off,
        aiResolved: conversations.ai_resolved,
      },
      rates: {
        /**
         * Deliberately different denominators.
         *
         * Resolution is an *outcome*, so it is only meaningful over finished
         * work: a conversation opened a minute ago has not been resolved by
         * anyone, and counting it as AI-resolved inflates the number for as
         * long as the inbox is busy. Denominator is therefore closed
         * conversations only.
         *
         * Handoff is an *event*, not an outcome — it either happened or it
         * did not — so it is measured over every conversation in the range.
         *
         * Both are null rather than 0 when the denominator is empty: a rate
         * over nothing is undefined, and 0% would read as "the AI resolves
         * nothing", which is a different and alarming claim.
         */
        aiResolution:
          conversations.closed > 0 ? conversations.ai_resolved / conversations.closed : null,
        aiResolutionSampled: conversations.closed,
        handoff: total > 0 ? conversations.handed_off / total : null,
      },
      messages: {
        total: messages.total,
        fromCustomer: messages.from_customer,
        fromAi: messages.from_ai,
        fromAdmin: messages.from_admin,
        perConversation: total > 0 ? messages.total / total : null,
      },
      responseTime: {
        averageSeconds: responseTime.avg_seconds,
        medianSeconds: responseTime.median_seconds,
        sampled: responseTime.sampled,
      },
      conversationDuration: {
        averageSeconds: duration.avg_seconds,
        // Reported so a null average reads as "no closed conversations yet"
        // rather than as zero.
        sampled: duration.sampled,
      },
      handoffReasons: handoffReasons.map((row: { reason: string; count: number }) => ({
        reason: row.reason,
        count: row.count,
      })),
    };
  }

  /** Token usage and cost (master plan §44). */
  async aiUsage(organizationId: string, range: ResolvedRange) {
    const [totals] = await this.dataSource.query(
      `SELECT
         count(*)::int                                     AS requests,
         count(*) FILTER (WHERE success)::int               AS succeeded,
         count(*) FILTER (WHERE NOT success)::int           AS failed,
         COALESCE(sum(input_tokens), 0)::int                AS input_tokens,
         COALESCE(sum(output_tokens), 0)::int               AS output_tokens,
         COALESCE(sum(total_tokens), 0)::int                AS total_tokens,
         COALESCE(sum(estimated_cost_usd), 0)::float        AS cost_usd,
         avg(latency_ms)::float                             AS avg_latency_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95_latency_ms
       FROM ai_usage_logs
       WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3`,
      [organizationId, range.from, range.to],
    );

    const byModel = await this.dataSource.query(
      `SELECT model,
              provider,
              count(*)::int                              AS requests,
              COALESCE(sum(total_tokens), 0)::int        AS total_tokens,
              COALESCE(sum(estimated_cost_usd), 0)::float AS cost_usd
         FROM ai_usage_logs
        WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3
        GROUP BY model, provider
        ORDER BY cost_usd DESC`,
      [organizationId, range.from, range.to],
    );

    /**
     * Daily series.
     *
     * generate_series left-joined against the data, so days with no traffic
     * appear as zero rather than vanishing — a gap in a time series reads as
     * missing data, not as a quiet day.
     *
     * The upper bound subtracts a microsecond from the *timestamp* before
     * casting to a date, rather than subtracting a day from the date. `to` is
     * an exclusive timestamp, so `to::date - 1 day` drops the current day
     * whenever `to` is `now()` — the series would end yesterday while
     * `totals` above still counted today, and the chart would not add up to
     * the headline figure sitting next to it.
     *
     * Buckets are pinned to UTC rather than left to `date_trunc`'s reliance
     * on the session timezone, so a day boundary means the same thing no
     * matter which connection or deployment serves the request. Presenting
     * them in the viewer's timezone is a frontend concern.
     */
    const daily = await this.dataSource.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD')                    AS date,
              COALESCE(u.requests, 0)::int                    AS requests,
              COALESCE(u.total_tokens, 0)::int                AS total_tokens,
              COALESCE(u.cost_usd, 0)::float                  AS cost_usd
         FROM generate_series(
                ($2 AT TIME ZONE 'UTC')::date,
                (($3 AT TIME ZONE 'UTC') - interval '1 microsecond')::date,
                interval '1 day'
              ) AS d(day)
         LEFT JOIN (
           SELECT (created_at AT TIME ZONE 'UTC')::date     AS day,
                  count(*)                                  AS requests,
                  sum(total_tokens)                         AS total_tokens,
                  sum(estimated_cost_usd)                   AS cost_usd
             FROM ai_usage_logs
            WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3
            GROUP BY 1
         ) AS u ON u.day = d.day
        ORDER BY d.day`,
      [organizationId, range.from, range.to],
    );

    const [tools] = await this.dataSource.query(
      `SELECT count(*)::int                                          AS executions,
              count(*) FILTER (WHERE status = 'SUCCESS')::int        AS succeeded,
              count(*) FILTER (WHERE status = 'REJECTED')::int       AS rejected,
              count(*) FILTER (WHERE status = 'FAILED')::int         AS failed,
              avg(duration_ms)::float                                AS avg_duration_ms
         FROM tool_executions
        WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3`,
      [organizationId, range.from, range.to],
    );

    const byTool = await this.dataSource.query(
      `SELECT tool_name AS name,
              count(*)::int                                   AS executions,
              count(*) FILTER (WHERE status = 'SUCCESS')::int  AS succeeded
         FROM tool_executions
        WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3
        GROUP BY tool_name
        ORDER BY executions DESC`,
      [organizationId, range.from, range.to],
    );

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totals: {
        requests: totals.requests,
        succeeded: totals.succeeded,
        failed: totals.failed,
        inputTokens: totals.input_tokens,
        outputTokens: totals.output_tokens,
        totalTokens: totals.total_tokens,
        estimatedCostUsd: totals.cost_usd,
        averageLatencyMs: totals.avg_latency_ms,
        p95LatencyMs: totals.p95_latency_ms,
      },
      byModel: byModel.map(
        (row: { model: string; provider: string; requests: number; total_tokens: number; cost_usd: number }) => ({
          model: row.model,
          provider: row.provider,
          requests: row.requests,
          totalTokens: row.total_tokens,
          estimatedCostUsd: row.cost_usd,
        }),
      ),
      daily: daily.map(
        (row: { date: string; requests: number; total_tokens: number; cost_usd: number }) => ({
          date: row.date,
          requests: row.requests,
          totalTokens: row.total_tokens,
          estimatedCostUsd: row.cost_usd,
        }),
      ),
      tools: {
        executions: tools.executions,
        succeeded: tools.succeeded,
        rejected: tools.rejected,
        failed: tools.failed,
        averageDurationMs: tools.avg_duration_ms,
        byTool: byTool.map((row: { name: string; executions: number; succeeded: number }) => ({
          name: row.name,
          executions: row.executions,
          succeeded: row.succeeded,
        })),
      },
    };
  }
}
