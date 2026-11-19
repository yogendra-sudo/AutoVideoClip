"""Write the e2e summary artifact (JSON + Markdown). No secrets."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import SCHEMA_VERSION, SUCCESS_RATE_THRESHOLD
from .judge import judge_suite
from .mask import redact


def write_report(path: Path, report: dict[str, Any], extras: list[str] | None = None) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    clean = redact({**report, 'schema_version': SCHEMA_VERSION}, extras)
    path.write_text(json.dumps(clean, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    markdown = path.with_suffix('.md')
    markdown.write_text(render_markdown(clean), encoding='utf-8')
    return clean


def render_markdown(report: dict[str, Any]) -> str:
    verdict = judge_suite(report)
    lines = [
        f"# Provider e2e — {report.get('suite', 'unknown')}",
        '',
        f"- Verdict: {'Passed' if verdict['passed'] else 'Failed' if not verdict.get('skipped') else 'Skipped'}",
        f"- Commit: `{report.get('commit') or 'unknown'}`",
        f"- Expected successes: {verdict.get('should_succeed_n', 0)}, success rate "
        f"{_pct(verdict.get('should_succeed_rate'))} (threshold {SUCCESS_RATE_THRESHOLD:.0%})",
        f"- Expected blocks: {verdict.get('should_block_n', 0)}, "
        f"{'all blocked before start with billable_calls_before_failure = 0' if verdict.get('should_block_passed') else 'did not achieve 100% blocking'}",
        f"- Injected faults: {verdict.get('fault_n', 0)}, "
        f"{'retried or resumed as expected for UpstreamErrorType' if verdict.get('fault_passed') else 'did not behave as expected'}",
    ]
    if report.get('mode'):
        lines.append(f"- Live mode: `{report['mode']}`")
    if report.get('iso_week') is not None:
        lines.append(f"- ISO week: {report['iso_week']}")
    budget = report.get('budget') or {}
    if budget:
        lines.append(
            f"- Budget: estimated month-to-date ¥{budget.get('spent_cny', 0):.2f} + estimated run ¥{budget.get('estimate_cny', 0):.2f}"
            f" / monthly cap ¥{budget.get('cap_cny', 0):.0f}; actual run ¥{report.get('spent_cny', 0):.2f}"
        )
    if report.get('reason'):
        lines.append(f"- Note: {report['reason']}")
    if verdict.get('history_note'):
        lines.append(f"- Rolling window: {verdict['history_note']}")
    for reason in verdict.get('reasons') or []:
        lines.append(f"- Failure reason: {reason}")
    skipped = report.get('skipped_providers') or []
    if skipped:
        lines.append('- Skipped live providers: ' + ', '.join(
            f"{item.get('id')} ({item.get('reason')})" for item in skipped
        ))
    for item in report.get('providers') or []:
        cost = item.get('spent_cny')
        cost_bit = f", est. ¥{cost:.2f}" if isinstance(cost, (int, float)) else ''
        lines.append(
            f"- {item.get('label') or item.get('id')}: model `{item.get('model')}` "
            f"({item.get('model_source') or 'default'}) "
            f"{item.get('should_succeed_passed')}/{item.get('should_succeed_n')} expected successes, "
            f"{item.get('should_block_passed')}/{item.get('should_block_n')} expected blocks"
            f"{cost_bit}"
        )
    lines += [
        '',
        '| Case | Expected | Result | Error code | error_class | HTTP | billable | Est. cost |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ]
    for row in report.get('cases') or []:
        billed = row.get('billable_calls_before_failure')
        if billed is None:
            billed = row.get('billable_calls', 0)
        outcome = 'Aborted' if row.get('aborted') else ('Passed' if row.get('passed') else 'Failed')
        cost = row.get('estimated_cost_cny')
        cost_text = f'{cost:.2f}' if isinstance(cost, (int, float)) else '—'
        lines.append(
            f"| {row.get('label') or row.get('id')} | {row.get('expect')} | "
            f"{outcome} | {row.get('error_code') or '—'} | "
            f"{row.get('error_class') or row.get('upstream_error_type') or row.get('expected_upstream_error_type') or '—'} | "
            f"{row.get('http_status') or '—'} | "
            f"{billed} | {cost_text} |"
        )
    lines.append('')
    return '\n'.join(lines) + '\n'


def _pct(value: float | None) -> str:
    if value is None:
        return '—'
    return f'{value:.1%}'


def merge_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    cases = []
    skipped = []
    for report in reports:
        cases.extend(report.get('cases') or [])
        skipped.extend(report.get('skipped_providers') or [])
        if report.get('status') == 'skipped' and report.get('suite') == 'live':
            skipped.append({'id': 'live', 'reason': report.get('reason') or 'live suite skipped'})
    live = next((report for report in reports if report.get('suite') == 'live'), None)
    merged = {
        'schema_version': SCHEMA_VERSION,
        'suite': 'combined' if len(reports) > 1 else (reports[0].get('suite') if reports else 'combined'),
        'commit': next((report.get('commit') for report in reports if report.get('commit')), None),
        'cases': cases,
        'skipped_providers': skipped,
        'parts': [{'suite': report.get('suite'), 'status': report.get('status')} for report in reports],
    }
    if live:
        for key in (
            'mode', 'iso_week', 'budget', 'providers', 'window', 'spent_cny',
            'run_id', 'case_records', 'planned',
        ):
            if live.get(key) is not None:
                merged[key] = live[key]
    return merged
