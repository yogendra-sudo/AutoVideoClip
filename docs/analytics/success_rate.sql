-- 1.5.7 clip success rate (v4 definition). Terminal events are sent by the backend and synced after the dashboard merges. studio_generation_finished / studio_production_finished are sent by the backend
-- settle_attempt once each after it is persisted (runtime=desktop, analytics_environment is still AUTOVIDEOCLIP_BUILD_ENVIRONMENT).
-- The frontend no longer sends these two, to avoid double counting in the denominator. Both the numerator and denominator are these two terminal events; there is no separate start event to migrate.
-- This file builds on #416, taking the last value per (attempt_sequence, leaf, ts) and outputs unknown_flows / Figure 6. The query itself is unchanged.
-- Definitions are in docs/analytics/TRACKING_PLAN.md §6–§7. All queries share the same base / c definition.
--
-- When the denominator is 0 (sparse date / version / empty window) the ratio returns NULL, not NaN (R20 #142: nullIf(denominator, 0)).
-- Parameters (replaced at release/reporting time; no longer a rolling now() - 7d window):
--   {date_from}          fixed UTC start (inclusive), e.g. '2026-10-09 00:00:00'
--   {date_to}            fixed UTC end (exclusive), e.g. '2026-10-16 00:00:00'
--   {internal_cohort_id} internal account cohort id (project 450605 is currently 641509)
--   {release_1_5_7}     1.5.7 official release time (UTC, inclusive). The GitHub Release published_at looks like
--                        YYYY-MM-DDTHH:MM:SSZ; fill it as single-quoted 'YYYY-MM-DD HH:MM:SS' (drop T and Z).
--                        The person running RELEASE_CHECKLIST.md 3.5 Promote fills it into PostHog project 450605
--                        for each insight of this file in the 「AutoClip｜1.5.7 出片成功率」 dashboard
--                        (the released_at_text of the 1.5.7 row in version_releases). This file does not hardcode dates.
--                        Empty string '' means not yet filled: events from this version are all excluded. 1.5.6 and earlier are not in the table.
--
-- Definitions:
--   attempt  = one terminal attempt, deduplicated by attempt_id (take the last row); legacy rows without attempt_id count by event uuid.
--   flow     = one clip flow by a user: trace back via retry_of to the retry-chain root (at most 4 hops), using the root attempt's flow_id;
--              the result is the last attempt in that flow / retry chain, ordered by (attempt_sequence, leaf, ts): first by attempt_sequence
--              (the backend receipt's in-project sequence, #419; rows without a sequence count as 0, so attempts with a sequence always sort after older attempts), then by leaf
--              (end of the retry_of chain = an attempt that is not retried again), ts (observation time) is only used to break ties (out-of-order events do not change the result).
--   unknown flow = a flow with no attempt_sequence and more than one chain end (#419- era, multiple attempts with the same flow_id, cannot prove which
--              was last): excluded from the Figure 1 / Figure 5 flow numerator and denominator, counted separately as unknown_flows (R26 #362). Attempt level is unaffected,
--              single attempts or old flows with a complete retry_of chain are computed as usual.
--   person   = person_id (not distinct_id / device).
--   success  = outcome IN ('completed','success'). partial does not count as success and is counted separately as the partial-delivery rate.
--   Full-definition denominator exclusions (user_hard, only clear user behavior excluded):
--     outcome = cancelled; error_code IN (authentication, llm_auth_invalid, invalid_key, insufficient_quota,
--     llm_not_configured, cancelled, user_cancelled); upstream_error_type IN (invalid_key, insufficient_quota, permission_denied).
--   Product-definition denominator further excludes (user_x): error_code IN (connection, source_too_short, source_no_audio, source_unreadable, source_blocked, source_not_found).
--   Both definitions count as product failures (not excluded): whisperper_not_installed, service_restarted, model_not_found, bad_endpoint
--   (error_code or upstream_error_type).
-- Only analytics_environment = 'production' and runtime = 'desktop' are considered, internal cohort excluded.
-- validation / development are still excluded by the filter above. Internal accounts built as production are still excluded via {internal_cohort_id}.
-- Old 1.5.7 internal test packages are also production + desktop; both internal cohorts are empty, so environment and cohort cannot be separated.
-- The version_releases table gives the public versions in the table a release-time floor: timestamp >= released_at (inclusive) counts.
-- 1.5.6 and earlier are not in the table and are not affected by this floor. Events carry no commit or build time; no field is added here and the cohort is not changed.
-- Figure 5 still groups by app_version.
--   frame_extract_failed (local frame extraction failure, 1.5.7 R11) is a product failure, counted in both denominators, and is not in any exclusion list.
--   frame_extract_subtitle_fallback / source_too_long_subtitle_route / vision_*_subtitle_fallback are degrade_reason (degraded to subtitles) on successful clips,
--   not failure codes; see Figure 6.

-- Figure 1: daily per-attempt / per-flow success rate (full + product) and partial-delivery rate
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(toString(coalesce(properties.flow_id, properties.attempt_id, toString(uuid))), timestamp) AS fid,
    argMax(person_id, timestamp) AS pid,
    max(timestamp) AS ts,
    -- R25 #346: the backend receipt's per-project attempt sequence (NULL on rows from before #419)
    max(toInt(properties.attempt_sequence)) AS seq,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.error_code), ''), timestamp) AS ec,
    argMax(coalesce(toString(properties.upstream_error_type), ''), timestamp) AS ue,
    argMax(coalesce(toString(properties.failure_stage), '(empty)'), timestamp) AS stage,
    argMax(toString(properties.app_version), timestamp) AS v,
    argMax(coalesce(toString(properties.retry_of), ''), timestamp) AS rof
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), chained AS (
  -- retry chain: follow retry_of up to 4 hops to the chain root, the flow is the root's flow.
  SELECT b.*,
    multiIf(p4.aid != '', p4.fid, p3.aid != '', p3.fid, p2.aid != '', p2.fid, p1.aid != '', p1.fid, b.fid) AS chain_fid,
    multiIf(r.retried != '', 0, 1) AS leaf
  FROM base b
  LEFT JOIN base p1 ON b.rof = p1.aid
  LEFT JOIN base p2 ON p1.rof = p2.aid
  LEFT JOIN base p3 ON p2.rof = p3.aid
  LEFT JOIN base p4 ON p3.rof = p4.aid
  -- R26 #362: leaf = no other attempt retries this one (the end of a retry_of chain); orders legacy flows
  LEFT JOIN (SELECT DISTINCT rof AS retried FROM base WHERE rof != '') r ON r.retried = b.aid
), c AS (
  SELECT *,
    multiIf(o_raw IN ('completed', 'success'), 'success', o_raw = 'partial', 'partial', o_raw IN ('cancelled', 'canceled'), 'cancelled', 'error') AS o,
    (o = 'cancelled'
      OR ec IN ('authentication', 'llm_auth_invalid', 'invalid_key', 'insufficient_quota', 'llm_not_configured', 'cancelled', 'user_cancelled')
      OR ue IN ('invalid_key', 'insufficient_quota', 'permission_denied')) AS user_hard,
    (user_hard OR ec IN ('connection', 'source_too_short', 'source_no_audio', 'source_unreadable', 'source_blocked', 'source_not_found', 'source_unsupported')) AS user_x,
    (o = 'success' OR NOT user_hard) AS qual_all,
    (o = 'success' OR NOT user_x) AS qual
    , (ifNull(seq, 0), leaf, ts) AS ord
  FROM chained
), flows AS (
  -- per-flow outcome = the LAST attempt in the flow / retry chain
  SELECT chain_fid AS fid, max(ts) AS fts, argMax(o, ord) AS fo, argMax(qual, ord) AS fq, argMax(qual_all, ord) AS fqa,
    -- R26 #362: a flow with no attempt_sequence and more than one chain end has no provable last attempt: unknown
    (countIf(seq IS NOT NULL) = 0 AND sum(leaf) > 1) AS unknown FROM c GROUP BY chain_fid
), d1 AS (
  SELECT toDate(ts) AS d, countIf(o = 'success') AS ok, countIf(qual_all) AS q_all, countIf(qual) AS q_prod,
    countIf(o = 'partial' AND qual) AS partial_n
  FROM c GROUP BY d
), d2 AS (
  SELECT toDate(fts) AS d, countIf(fo = 'success' AND NOT unknown) AS flow_ok, countIf(fqa AND NOT unknown) AS fq_all,
    countIf(fq AND NOT unknown) AS fq_prod, countIf(unknown) AS unknown_n FROM flows GROUP BY d
)
SELECT toString(d1.d) AS dt, d1.ok AS ok,
  round(d1.ok / nullIf(d1.q_all, 0), 3) AS overall_attempt_rate, round(d1.ok / nullIf(d1.q_prod, 0), 3) AS product_attempt_rate,
  round(d2.flow_ok / nullIf(d2.fq_all, 0), 3) AS overall_flow_rate, round(d2.flow_ok / nullIf(d2.fq_prod, 0), 3) AS product_flow_rate,
  round(d1.partial_n / nullIf(d1.q_prod, 0), 3) AS partial_delivery_rate,
  d1.q_all AS q_all, d1.q_prod AS q_prod, d2.flow_ok AS flow_ok, d2.fq_all AS fq_all, d2.fq_prod AS fq_prod,
  d2.unknown_n AS unknown_flows
FROM d1 LEFT JOIN d2 ON d1.d = d2.d
ORDER BY dt;

-- Figure 2: per-person (person_id) first qualified clip success rate (full + product)
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(person_id, timestamp) AS pid,
    max(timestamp) AS ts,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.error_code), ''), timestamp) AS ec,
    argMax(coalesce(toString(properties.upstream_error_type), ''), timestamp) AS ue
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), c AS (
  SELECT *,
    multiIf(o_raw IN ('completed', 'success'), 'success', o_raw = 'partial', 'partial', o_raw IN ('cancelled', 'canceled'), 'cancelled', 'error') AS o,
    (o = 'cancelled'
      OR ec IN ('authentication', 'llm_auth_invalid', 'invalid_key', 'insufficient_quota', 'llm_not_configured', 'cancelled', 'user_cancelled')
      OR ue IN ('invalid_key', 'insufficient_quota', 'permission_denied')) AS user_hard,
    (user_hard OR ec IN ('connection', 'source_too_short', 'source_no_audio', 'source_unreadable', 'source_blocked', 'source_not_found', 'source_unsupported')) AS user_x,
    (o = 'success' OR NOT user_hard) AS qual_all,
    (o = 'success' OR NOT user_x) AS qual
  FROM base
), p AS (
  SELECT pid, argMinIf(o, ts, qual_all) AS f_all, argMinIf(o, ts, qual) AS f_prod,
    countIf(qual_all) > 0 AS has_all, countIf(qual) > 0 AS has_prod
  FROM c GROUP BY pid
)
SELECT countIf(has_all AND f_all = 'success') AS overall_first_ok, countIf(has_all) AS overall_people,
  round(overall_first_ok / nullIf(overall_people, 0), 3) AS overall_first_rate,
  countIf(has_prod AND f_prod = 'success') AS product_first_ok, countIf(has_prod) AS product_people,
  round(product_first_ok / nullIf(product_people, 0), 3) AS product_first_rate
FROM p;

-- Figure 3: failure identity (failure_stage × error_code × attribution), deduplicated by attempt
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.error_code), ''), timestamp) AS ec,
    argMax(coalesce(toString(properties.upstream_error_type), ''), timestamp) AS ue,
    argMax(coalesce(toString(properties.failure_stage), '(empty)'), timestamp) AS stage
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), c AS (
  SELECT *,
    multiIf(o_raw IN ('completed', 'success'), 'success', o_raw = 'partial', 'partial', o_raw IN ('cancelled', 'canceled'), 'cancelled', 'error') AS o,
    (o = 'cancelled'
      OR ec IN ('authentication', 'llm_auth_invalid', 'invalid_key', 'insufficient_quota', 'llm_not_configured', 'cancelled', 'user_cancelled')
      OR ue IN ('invalid_key', 'insufficient_quota', 'permission_denied')) AS user_hard,
    (user_hard OR ec IN ('connection', 'source_too_short', 'source_no_audio', 'source_unreadable', 'source_blocked', 'source_not_found', 'source_unsupported')) AS user_x
  FROM base
)
SELECT stage, if(ec = '', '(empty)', ec) AS error_code, o AS outcome,
  multiIf(user_hard, 'user_both', user_x, 'user_product_only', 'product') AS attribution, count() AS attempts
FROM c WHERE o != 'success'
GROUP BY stage, error_code, outcome, attribution
ORDER BY attempts DESC;

-- Figure 4: model request upstream errors (diagnostic, not a success-rate denominator)
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
)
SELECT
  properties.provider AS provider,
  properties.upstream_error_type AS upstream_error_type,
  count() AS events
FROM events
LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
WHERE event = 'llm_request_finished'
  AND toString(properties.analytics_environment) = 'production'
  AND properties.outcome = 'error'
  AND timestamp >= toDateTime({date_from}, 'UTC')
  AND timestamp < toDateTime({date_to}, 'UTC')
  AND person_id NOT IN COHORT {internal_cohort_id}
  -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
  AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
GROUP BY provider, upstream_error_type
ORDER BY events DESC;


-- Figure 5: per-version (app_version) per-attempt / per-flow success rate (full + product) and partial-delivery rate
-- Same base / chained / c as Figure 1; flows are attributed to the version of the last attempt
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(toString(coalesce(properties.flow_id, properties.attempt_id, toString(uuid))), timestamp) AS fid,
    argMax(person_id, timestamp) AS pid,
    max(timestamp) AS ts,
    -- R25 #346: the backend receipt's per-project attempt sequence (NULL on rows from before #419)
    max(toInt(properties.attempt_sequence)) AS seq,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.error_code), ''), timestamp) AS ec,
    argMax(coalesce(toString(properties.upstream_error_type), ''), timestamp) AS ue,
    argMax(coalesce(toString(properties.failure_stage), '(empty)'), timestamp) AS stage,
    argMax(toString(properties.app_version), timestamp) AS v,
    argMax(coalesce(toString(properties.retry_of), ''), timestamp) AS rof
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), chained AS (
  -- retry chain: follow retry_of up to 4 hops to the chain root, the flow is the root's flow.
  SELECT b.*,
    multiIf(p4.aid != '', p4.fid, p3.aid != '', p3.fid, p2.aid != '', p2.fid, p1.aid != '', p1.fid, b.fid) AS chain_fid,
    multiIf(r.retried != '', 0, 1) AS leaf
  FROM base b
  LEFT JOIN base p1 ON b.rof = p1.aid
  LEFT JOIN base p2 ON p1.rof = p2.aid
  LEFT JOIN base p3 ON p2.rof = p3.aid
  LEFT JOIN base p4 ON p3.rof = p4.aid
  -- R26 #362: leaf = no other attempt retries this one (the end of a retry_of chain); orders legacy flows
  LEFT JOIN (SELECT DISTINCT rof AS retried FROM base WHERE rof != '') r ON r.retried = b.aid
), c AS (
  SELECT *,
    multiIf(o_raw IN ('completed', 'success'), 'success', o_raw = 'partial', 'partial', o_raw IN ('cancelled', 'canceled'), 'cancelled', 'error') AS o,
    (o = 'cancelled'
      OR ec IN ('authentication', 'llm_auth_invalid', 'invalid_key', 'insufficient_quota', 'llm_not_configured', 'cancelled', 'user_cancelled')
      OR ue IN ('invalid_key', 'insufficient_quota', 'permission_denied')) AS user_hard,
    (user_hard OR ec IN ('connection', 'source_too_short', 'source_no_audio', 'source_unreadable', 'source_blocked', 'source_not_found', 'source_unsupported')) AS user_x,
    (o = 'success' OR NOT user_hard) AS qual_all,
    (o = 'success' OR NOT user_x) AS qual
    , (ifNull(seq, 0), leaf, ts) AS ord
  FROM chained
), flows AS (
  SELECT chain_fid AS fid, argMax(v, ord) AS fv, argMax(o, ord) AS fo, argMax(qual, ord) AS fq, argMax(qual_all, ord) AS fqa,
    -- R26 #362: a flow with no attempt_sequence and more than one chain end has no provable last attempt: unknown
    (countIf(seq IS NOT NULL) = 0 AND sum(leaf) > 1) AS unknown FROM c GROUP BY chain_fid
), v1 AS (
  SELECT v, countIf(o = 'success') AS ok, countIf(qual_all) AS q_all, countIf(qual) AS q_prod,
    countIf(o = 'partial' AND qual) AS partial_n
  FROM c GROUP BY v
), v2 AS (
  SELECT fv AS v, countIf(fo = 'success' AND NOT unknown) AS flow_ok, countIf(fqa AND NOT unknown) AS fq_all,
    countIf(fq AND NOT unknown) AS fq_prod, countIf(unknown) AS unknown_n FROM flows GROUP BY fv
)
SELECT v1.v AS app_version, v1.ok AS ok,
  round(v1.ok / nullIf(v1.q_all, 0), 3) AS overall_attempt_rate, round(v1.ok / nullIf(v1.q_prod, 0), 3) AS product_attempt_rate,
  round(v2.flow_ok / nullIf(v2.fq_all, 0), 3) AS overall_flow_rate, round(v2.flow_ok / nullIf(v2.fq_prod, 0), 3) AS product_flow_rate,
  round(v1.partial_n / nullIf(v1.q_prod, 0), 3) AS partial_delivery_rate,
  v1.q_all AS q_all, v1.q_prod AS q_prod, v2.flow_ok AS flow_ok, v2.fq_all AS fq_all, v2.fq_prod AS fq_prod,
  v2.unknown_n AS unknown_flows
FROM v1 LEFT JOIN v2 ON v1.v = v2.v
ORDER BY app_version;

-- Figure 6: successful clips degraded to subtitles (degrade_reason, not failures; not in any exclusion list), deduplicated by attempt
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
)
SELECT degrade_reason, count() AS attempts
FROM (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.degrade_reason), ''), timestamp) AS degrade_reason
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    -- An unmatched HogQL LEFT JOIN yields '' instead of NULL; versions outside the table (1.5.6 and earlier) also pass.
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
)
WHERE o_raw IN ('completed', 'success')
  AND degrade_reason IN ('vision_unavailable_subtitle_fallback', 'vision_invalid_subtitle_fallback',
                         'frame_extract_subtitle_fallback', 'source_too_long_subtitle_route')
GROUP BY degrade_reason
ORDER BY attempts DESC;

-- Figure 7 (M1): first-attempt success share
-- Devices with at least one terminal event with attempt_index_on_device = 1 in the window; the numerator is devices whose first attempt succeeded.
-- Historical rows without attempt_index_on_device are excluded from this figure (impossible to determine "first" before the M1 release).
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(person_id, timestamp) AS pid,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    max(toInt(properties.attempt_index_on_device)) AS attempt_index
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), firsts AS (
  SELECT pid,
    max(if(attempt_index = 1 AND o_raw IN ('completed', 'success'), 1, 0)) AS first_ok,
    max(if(attempt_index = 1, 1, 0)) AS has_first
  FROM base
  WHERE attempt_index IS NOT NULL AND attempt_index >= 1
  GROUP BY pid
)
SELECT
  countIf(has_first = 1) AS devices_with_first_attempt,
  countIf(first_ok = 1) AS first_try_success_devices,
  round(countIf(first_ok = 1) / nullIf(countIf(has_first = 1), 0), 3) AS first_try_success_rate
FROM firsts;

-- Figure 8 (M1): never-succeeded share (devices with a terminal event in the window but no success in the window)
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(person_id, timestamp) AS pid,
    argMax(toString(properties.outcome), timestamp) AS o_raw
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
  GROUP BY aid
), devices AS (
  SELECT pid,
    countIf(o_raw IN ('completed', 'success')) AS ok_n,
    count() AS attempts
  FROM base
  GROUP BY pid
)
SELECT
  count() AS active_devices,
  countIf(ok_n = 0) AS never_succeeded_devices,
  round(countIf(ok_n = 0) / nullIf(count(), 0), 3) AS never_succeeded_rate
FROM devices
WHERE attempts > 0;

-- Figure 9 (M1): per-provider device-level success rate (same shape as F1 provider_quality_report: last qualified attempt per device per provider)
-- Product-definition exclusions are identical to Figure 1's user_x; the F1 JSON schema is unchanged.
WITH version_releases AS (
  SELECT '1.5.7' AS app_version, {release_1_5_7} AS released_at_text
), base AS (
  SELECT
    toString(coalesce(properties.attempt_id, toString(uuid))) AS aid,
    argMax(person_id, timestamp) AS pid,
    max(timestamp) AS ts,
    argMax(toString(properties.outcome), timestamp) AS o_raw,
    argMax(coalesce(toString(properties.error_code), ''), timestamp) AS ec,
    argMax(coalesce(toString(properties.upstream_error_type), ''), timestamp) AS ue,
    argMax(toString(properties.provider), timestamp) AS provider
  FROM events
  LEFT JOIN version_releases vr ON vr.app_version = toString(properties.app_version)
  WHERE event IN ('studio_generation_finished', 'studio_production_finished')
    AND toString(properties.analytics_environment) = 'production'
    AND toString(properties.runtime) = 'desktop'
    AND timestamp >= toDateTime({date_from}, 'UTC')
    AND timestamp < toDateTime({date_to}, 'UTC')
    AND person_id NOT IN COHORT {internal_cohort_id}
    AND (vr.app_version IS NULL OR vr.app_version = '' OR (vr.released_at_text != '' AND timestamp >= toDateTime(nullIf(vr.released_at_text, ''), 'UTC')))
    AND toString(properties.provider) != ''
  GROUP BY aid
), c AS (
  SELECT *,
    multiIf(o_raw IN ('completed', 'success'), 'success', o_raw = 'partial', 'partial', o_raw IN ('cancelled', 'canceled'), 'cancelled', 'error') AS o,
    (o = 'cancelled'
      OR ec IN ('authentication', 'llm_auth_invalid', 'invalid_key', 'insufficient_quota', 'llm_not_configured', 'cancelled', 'user_cancelled')
      OR ue IN ('invalid_key', 'insufficient_quota', 'permission_denied')) AS user_hard,
    (user_hard OR ec IN ('connection', 'source_too_short', 'source_no_audio', 'source_unreadable', 'source_blocked', 'source_not_found', 'source_unsupported')) AS user_x
  FROM base
), qualified AS (
  SELECT * FROM c WHERE o = 'success' OR NOT user_x
), per_device AS (
  SELECT pid, provider, argMax(o, ts) AS latest_outcome
  FROM qualified
  GROUP BY pid, provider
)
SELECT
  provider,
  count() AS devices,
  countIf(latest_outcome = 'success') AS success_devices,
  round(countIf(latest_outcome = 'success') / nullIf(count(), 0), 3) AS success_rate
FROM per_device
GROUP BY provider
ORDER BY success_rate DESC, devices DESC;


-- ---------------------------------------------------------------------------
-- Figure 10: service_restarted by crash_exit × crash_stage (1.5.9)
-- ---------------------------------------------------------------------------
-- Definition: same production / desktop / cohort / {date_from}/{date_to} as above.
-- studio_generation_finished with error_code = service_restarted and restart_reason = crash.
-- Attributes are enums/buckets, no raw exit codes. Counted by event (no longer using distinct_id).
SELECT
  toString(properties.crash_exit) AS crash_exit,
  toString(properties.crash_stage) AS crash_stage,
  count() AS restarts
FROM events
WHERE event = 'studio_generation_finished'
  AND toString(properties.analytics_environment) = 'production'
  AND toString(properties.runtime) = 'desktop'
  AND timestamp >= toDateTime({date_from}, 'UTC')
  AND timestamp < toDateTime({date_to}, 'UTC')
  AND person_id NOT IN COHORT {internal_cohort_id}
  AND toString(properties.error_code) = 'service_restarted'
  AND toString(properties.restart_reason) = 'crash'
GROUP BY 1, 2
ORDER BY restarts DESC;
