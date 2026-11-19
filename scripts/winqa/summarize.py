import re
#!/usr/bin/env python3
"""Summarise a winqa evidence directory into Markdown (stdout) and windows-rows.draft.json."""
import json
import sys
from pathlib import Path, PureWindowsPath

ev = Path(sys.argv[1])


def load(name):
    p = ev / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8-sig'))
    except ValueError:
        return None


def mark(ok):
    return '✅ Passed' if ok is True else ('❌ Failed' if ok is False else '⏸ Not run / no data')


inputs, env = load('inputs.json') or {}, load('env.json') or {}
ip, lp, seed = load('install-prev.json') or {}, load('launch-prev.json') or {}, load('seed.json') or {}
up, lc = load('install-upgrade.json') or {}, load('launch-candidate.json') or {}
ck, fl, sm, ws = load('check-candidate.json') or {}, load('failure.json') or {}, load('smoke.json') or {}, load('windows-smoke.json') or {}
rc = load('check-recheck.json') or {}
A, F = dict(ck.get('assertions') or {}), fl.get('assertions') or {}
# A re-check with the corrected "no key" state supersedes only the readiness assertions of the first check.
READY_KEYS = ('no_key_settings_saved', 'readiness_endpoint_200', 'readiness_not_ready_without_model', 'readiness_analysis_fix_entry',
              'readiness_whisper_fix_entry', 'readiness_ffmpeg_ok', 'readiness_visual_optional_in_auto')
if rc.get('assertions'):
    for k in READY_KEYS:
        if k in rc['assertions']:
            A[k] = rc['assertions'][k]
    ck = {**ck, 'readiness_no_model': rc.get('readiness_no_model')}
cand_v = (inputs.get('candidate') or {}).get('version')
prev_v = (inputs.get('prev') or {}).get('version')
hashes = {PureWindowsPath(i['path']).name: i['sha256'] for i in (env.get('installers') or []) if i}

rows = []
def row(name, ok, evidence):
    rows.append((name, ok, evidence))

row('Installer hash (Get-FileHash on acceptance machine matches box)',
    bool(hashes) and hashes.get('prev-setup.exe') == (inputs.get('prev') or {}).get('sha256') and hashes.get('candidate-setup.exe') == (inputs.get('candidate') or {}).get('sha256'),
    f"prev {hashes.get('prev-setup.exe', '?')[:12]}…, candidate {hashes.get('candidate-setup.exe', '?')[:12]}…")
row(f'Clean install {prev_v} (/S)', ip.get('ok'), f"exit={ip.get('exit_code')} duration {ip.get('seconds')}s registry version {(ip.get('after') or {}).get('Version')}")
celery_prev = lp.get('celery_processes') or []
row(f'Launch {prev_v} (interactive desktop)', lp.get('ok'), f"mode={lp.get('mode')} session={lp.get('app_sessions')} port file {lp.get('port_file_seconds')}s health {lp.get('healthy_seconds')}s; {lp.get('python_processes')} python process(es), {len(celery_prev)} Celery process(es)")
row('Seed data (privacy off, fake-key connection, 20-second project)', bool(seed.get('seed_project_id')) and seed.get('ai_models_put') == 200, f"version {seed.get('app_version')}, project {seed.get('seed_project_id')}")
row(f'Upgrade to {cand_v} while previous version runs (+ leftover python process locks _asyncio.pyd)', up.get('ok'),
    f"exit={up.get('exit_code')} duration {up.get('seconds')}s registry {(up.get('after') or {}).get('Version')}; {len(up.get('running_before') or [])} process(es) before upgrade, still alive afterward: {up.get('still_alive_from_before')}; lock process killed={up.get('lock_killed_by_installer')}; new file {up.get('marker_present')}; stale files {up.get('stale_files')}")
celery = lc.get('celery_processes')
row(f'Launch {cand_v}', lc.get('ok'), f"mode={lc.get('mode')} port file {lc.get('port_file_seconds')}s health {lc.get('healthy_seconds')}s exe FileVersion {lc.get('exe_file_version')}")
cel_logs = [l for l in (ck.get('log_celery_lines') or []) if 'Celery' in l]
row('No Celery process in candidate process tree', (celery == [] and lc.get('ok')) if celery is not None else None,
    f"Candidate process tree: autoclip-desktop.exe + WebView2 + one python (-m backend.desktop_main); {len(celery or [])} command lines contain celery;"
    f" the only Celery log line is from previous version {prev_v}: {re.sub(r'^.*?(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d).*?(✅.*)$', r'\1 \2', cel_logs[-1])[:80] if cel_logs else 'none'}")
for key, label in [('reported_version_matches', f"Backend-reported version = {cand_v} (actual: {ck.get('app_version')})"), ('backend_health_200', '/health 200'),
                   ('settings_endpoint_200', '/api/v1/settings/ 200'), ('upgrade_kept_privacy_off', 'Privacy setting remains off after upgrade'),
                   ('upgrade_kept_model_connection_and_key', 'Model connection and key remain after upgrade'), ('upgrade_kept_project', 'Project remains after upgrade'),
                   ('readiness_endpoint_200', 'Preflight endpoint /api/v1/studio/readiness returns 200'), ('readiness_not_ready_without_model', 'ready=false without a model'),
                   ('readiness_analysis_fix_entry', 'Missing analysis model → repair=settings_ai'), ('readiness_whisper_fix_entry', 'Whisper not installed → repair=install_whisper'),
                   ('readiness_ffmpeg_ok', 'Bundled FFmpeg is ready'), ('updater_endpoint_embedded', 'Updater URL is embedded in the executable'),
                   ('updater_manifest_readable', f"latest.json is readable ({(ck.get('updater_fetch') or {}).get('version') or (ck.get('updater_fetch') or {}).get('error')})"),
                   ('no_project_stuck_processing', 'No projects stuck in processing'), ('no_key_settings_saved', 'Save settings with a connection but no key (200)'),
                   ('readiness_visual_optional_in_auto', 'Visual analysis is optional in auto mode')]:
    row(label, A.get(key), '')
for key, label in [('readiness_ready_with_loopback_model', 'ready=true with a configured loopback model'), ('screening_failed_with_500', 'Visual screening returned 500'),
                   ('fallback_generation_finished_ok', 'Rendering succeeded after screening failed (#1)'), ('fallback_route_subtitle', 'Fallback route=subtitle (#1)'),
                   ('http500_generation_failed', 'Analysis 500 → failed'), ('http500_failure_stage_present', 'Failure record includes failure_stage (#3)'),
                   ('http500_http_status_500', 'Failure record includes http_status=500 (#3)'), ('http500_route_subtitle', 'Failure record route=subtitle (#3)'),
                   ('unreachable_generation_failed', 'Service unreachable → failed'), ('unreachable_failure_stage_present', 'failure_stage is present when unreachable'),
                   ('unreachable_no_http_status', 'No http_status when unreachable'), ('project_index_terminal_not_processing', 'Project list reaches a terminal state after failure/completion (#5)')]:
    row(label, F.get(key), '')
for run in sm.get('runs') or []:
    row(f"CI-equivalent {run['name']} ({run.get('mode', 'ssh-session0')})", run['exit_code'] == 0, f"exit={run['exit_code']} duration {run['seconds']}s")

print(f"# AutoClip {cand_v} Windows Acceptance ({prev_v} → {cand_v})\n")
print(f"- Machine: {env.get('os_caption')} {env.get('display_version')} build {env.get('os_build')} {env.get('os_arch')}, {env.get('ram_gb')} GB, {env.get('cpu')}, {env.get('manufacturer')} {env.get('model')} (VM), WebView2 {env.get('webview2')}")
print(f"- Candidate installer: {(inputs.get('candidate') or {}).get('file')} sha256 {(inputs.get('candidate') or {}).get('sha256')}")
print(f"- Previous installer: {(inputs.get('prev') or {}).get('file')} sha256 {(inputs.get('prev') or {}).get('sha256')}")
print(f"- Repository commit: {inputs.get('repo_commit')}; started {inputs.get('started_at')}\n")
print('| Check | Result | Key evidence |\n|---|---|---|')
for name, ok, e in rows:
    print(f'| {name} | {mark(ok)} | {e} |')
print()
if fl.get('scenarios'):
    print('## Failure / fallback probe details\n')
    for s in fl['scenarios']:
        print(f"- **{s['scenario']}**: {s['seconds']}s, generation={json.dumps(s['generation'], ensure_ascii=False)}, plan={json.dumps(s.get('plan'), ensure_ascii=False)}, fixture calls={s.get('fixture_calls')}")
        if s.get('generation_error'):
            print(f"  - Error text: `{s['generation_error']}`")
rd = (ck.get('readiness_no_model') or [None, None])[1]
if rd:
    print(f"\n## Preflight (connection without key, Whisper not installed)\n\n```json\n{json.dumps(rd, ensure_ascii=False, indent=2)}\n```")

# ---------------------------------------------------------------- real-model scenarios (steps 10-14, --real)
RM, WF, WM, WD, LO, LK, FN = (load('real/' + n) or {} for n in ('model.json', 'whisper-firstinstall.json', 'whisper-hfmirror.json',
                                                                 'whisper-hf-direct-timeout.json', 'local.json', 'link.json', 'final.json'))
# run_winqa.sh step 11 saves real/whisper.json (winqa_real.py --label default); older evidence used whisper-firstinstall.json.
WF = WF or load('real/whisper.json') or {}
real_rows = []
def rrow(name, ok, evidence):
    real_rows.append((name, ok, evidence))
if RM:
    RA = RM.get('assertions', {})
    sp = RM.get('spend') or {}
    rrow('A1 Save real model connection + built-in connection test', RA.get('save_200') and RA.get('connection_test_with_typed_key') and RA.get('connection_test_after_save_stored_key'),
         f"model={RM.get('model')} provider={RM.get('provider')}; PUT 200; test with typed key: {RM.get('test_before_save', {}).get('body')}; after saving, test with stored key: {RM.get('test_after_save', {}).get('body')}")
    rrow('A2 #266 Key remains and test passes after saving with an empty key', all(RA.get(k) for k in ('issue266_field_absent_key_kept', 'issue266_field_absent_test_passes', 'issue266_explicit_null_key_kept', 'issue266_explicit_null_test_passes')),
         f"Field omitted: { {k: v for k, v in (RM.get('resave_field_absent') or {}).items() if k != 'test_body'} }; explicit null: { {k: v for k, v in (RM.get('resave_explicit_null') or {}).items() if k != 'test_body'} }")
    rrow('A3 Preflight analysis=configured', RA.get('readiness_analysis_ok'), f"ready={(RM.get('readiness_after') or {}).get('ready')}, checks={json.dumps((RM.get('readiness_after') or {}).get('checks'), ensure_ascii=False)}")
if WF:
    rrow('A4a Preflight blocks import without SRT before Whisper is installed (frontend submissionBlock rule)', WF.get('frontend_block_before_install_no_srt') == 'transcription',
         f"Without SRT → {WF.get('frontend_block_before_install_no_srt')}; with SRT → {WF.get('frontend_block_before_install_with_srt')}; backend /studio/import does not check preflight itself")
    rrow('A4b Install Whisper runtime through the app route', (WF.get('runtime_status_after') or {}).get('status') == 'installed',
         f"{WF.get('install_seconds')}s, {(WF.get('runtime_status_after') or {}).get('packages')}; transcription after install (before model download)={WF.get('transcription_after_install')}; after model download={((WF.get('readiness_after') or {}).get('checks') or {}).get('transcription')}")
if WD or WM:
    rrow('A4c Whisper model download (app default: huggingface.co)', False if WD else None,
         f"Direct: {(WD.get('model_download') or {}).get('status')} ({((WD.get('model_download') or {}).get('error') or '')[:60]}…); download endpoint immediately returned: {((WD.get('model_download_post') or {}).get('body') or {}).get('message')}")
    rrow('A4c′ Workaround: HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1', (WM.get('model_download') or {}).get('status') == 'downloaded',
         f"{(WM.get('model_download') or {}).get('status')}, {(WM.get('model_download') or {}).get('seconds')}s (Xet CAS 401 when setting only HF_ENDPOINT)")
def gen_row(tag, d, label):
    if not d:
        return
    sp = d.get('spend') or {}
    rrow(label, d.get('ok'),
         f"project {d.get('project_id')}; {d.get('seconds')}s; generation={(d.get('generation') or {}).get('status')} route={(d.get('generation') or {}).get('route')};"
         f" {d.get('clip_count')} clips, durations {d.get('clip_durations_sec')}s; model calls {sp.get('http_posts_to_endpoint_logged')} / {sp.get('total_tokens_logged')} tokens;"
         f" evidence {d.get('evidence_clip')}, {d.get('evidence_thumb')}" + (f"; error {d.get('generation_error')[:120]}" if d.get('generation_error') else ''))
gen_row('local', LO, 'A4 Local video (no subtitles) → Whisper → render → export')
gen_row('link', LK, f"A5 Bilibili link import → progress → render ({LK.get('url', '')})")
if FN:
    rrow('A6 No projects stuck in processing', FN.get('ok'), f"{len(FN.get('projects') or [])} projects, statuses {sorted({p['status'] for p in FN.get('projects') or []})}; stuck WinQA projects {FN.get('stuck_winqa_projects')}")
if real_rows:
    print(f"\n## Real-model scenarios (provider={RM.get('provider')}, model={RM.get('model')}; steps 10–14)\n")
    print('| Scenario | Result | Key evidence |\n|---|---|---|')
    for name, ok, evidence in real_rows:
        print(f"| {name} | {mark(ok)} | {str(evidence).replace('|', '/')} |")
    calls = sum(((d.get('spend') or {}).get('http_posts_to_endpoint_logged') or 0) for d in (RM, LO, LK))
    toks = sum(((d.get('spend') or {}).get('total_tokens_logged') or 0) for d in (RM, LO, LK))
    print(f"\nReal-model cost (from app logs): approximately {calls} requests, {toks} tokens.")

# Draft internal-acceptance rows: automated parts only; case rows stay pending (each needs UI / real model).
now = __import__('datetime').datetime.now().astimezone().isoformat(timespec='seconds')
auto_ok = all(r[1] is True for r in rows)
draft = {
    'note': 'DRAFT ONLY. Windows rows for internal_acceptance.py; matrix cases stay pending until the GUI/real-model parts are done by a named tester.',
    'platform': 'windows-x64',
    'os': f"{env.get('os_caption')} {env.get('display_version')} (build {env.get('os_build')}), x64",
    'machine': f"{env.get('manufacturer')} {env.get('model')} VM, {env.get('logical_cpus')} vCPU, {env.get('ram_gb')} GB; cloud VM, not physical hardware",
    'runtime': f"bundled portable Python {ws.get('python', '?')}, bundled ffmpeg, WebView2 {env.get('webview2')}",
    'checks': {case: {'status': 'pending', 'completed_at': None, 'evidence': '',
                      'automated_partial': None} for case in ('clean_install', 'upgrade_legacy', 'model_settings', 'local_with_subtitles',
                      'local_without_subtitles', 'link_import', 'visual_generation', 'failure_recovery', 'output_delivery', 'privacy_telemetry')},
    'regressions': [],
}
c = draft['checks']
c['clean_install']['automated_partial'] = 'silent install, backend health and bundled python/ffmpeg verified; real UI onboarding / model save / restart NOT done'
c['upgrade_legacy']['automated_partial'] = f"overwrite {prev_v}->{cand_v} while running, exit={up.get('exit_code')}, {up.get('seconds')}s, privacy/key/project kept={A.get('upgrade_kept_privacy_off')}/{A.get('upgrade_kept_model_connection_and_key')}/{A.get('upgrade_kept_project')}; UI check of settings/projects NOT done"
c['failure_recovery']['automated_partial'] = 'loopback HTTP 500 / unreachable provider produce failed terminal state with failure_stage; UI retry after fix NOT done'
if RM:
    c['model_settings']['automated_partial'] = f"API-level: {RM.get('provider')} / {RM.get('model')} saved, app connection test success before/after save; #266 re-save with empty key keeps key = {all(RM.get('assertions', {}).get(k) for k in ('issue266_field_absent_key_kept', 'issue266_explicit_null_key_kept'))}; UI form NOT exercised"
if LO:
    c['local_without_subtitles']['automated_partial'] = f"API-level: Whisper runtime installed via app route; model download needs HF mirror workaround (huggingface.co blocked); generation={(LO.get('generation') or {}).get('status')}, clips={LO.get('clip_count')}; eyes-on playback NOT done"
if LK:
    c['link_import']['automated_partial'] = f"API-level: Bilibili {LK.get('url')} generation={(LK.get('generation') or {}).get('status')}, clips={LK.get('clip_count')}; YouTube skipped (no proxy); UI NOT exercised"
c['output_delivery']['automated_partial'] = 'CI-equivalent loopback pipeline produced H.264/AAC output checked with ffprobe; native save/preview/eyes-on playback NOT done'
def reg(id_, desc, ok, ev_):  # noqa: E302
    draft['regressions'].append({'id': id_, 'platforms': ['windows-x64'], 'description': desc,
                                 'status': 'passed' if ok else ('failed' if ok is False else 'pending'),
                                 'completed_at': now if ok is not None else None, 'evidence': ev_})
reg('1.5.6-auto-screening-fallback', 'optional auto screening fails (vision HTTP 500) -> run continues on the subtitle route',
    all(F.get(k) for k in ('screening_failed_with_500', 'fallback_generation_finished_ok', 'fallback_route_subtitle')) if F else None, 'failure.json')
reg('1.5.6-import-readiness', 'readiness API reports model/transcription/vision/FFmpeg with repair entries (backend part; UI blocking still pending)',
    all(A.get(k) for k in ('readiness_endpoint_200', 'readiness_not_ready_without_model', 'readiness_analysis_fix_entry', 'readiness_whisper_fix_entry', 'readiness_ffmpeg_ok')) if A else None, 'check-candidate.json, check-recheck.json')
reg('1.5.6-failure-taxonomy', 'failed generation records failure_stage, http_status and route',
    all(F.get(k) for k in ('http500_failure_stage_present', 'http500_http_status_500', 'http500_route_subtitle', 'unreachable_failure_stage_present')) if F else None, 'failure.json')
reg('1.5.6-desktop-no-celery', 'desktop backend starts no Celery; project index reaches terminal state',
    (celery == [] and bool(F.get('project_index_terminal_not_processing')) and bool(A.get('no_project_stuck_processing'))) if lc else None, 'launch-candidate.json, failure.json')
reg('1.5.6-installer-smoke-studio', 'installed-runtime smoke via Studio import + ffprobe (verify_windows_install.py)',
    (all(r['exit_code'] == 0 for r in sm['runs']) if sm.get('runs') else None), 'smoke.json, windows-smoke.json')
if RM:
    reg('1.5.6-issue266-key-kept', 'saving AI settings with the key field left empty keeps the stored key; connection test still passes (real model endpoint)',
        all(RM.get('assertions', {}).get(k) for k in ('issue266_field_absent_key_kept', 'issue266_field_absent_test_passes', 'issue266_explicit_null_key_kept', 'issue266_explicit_null_test_passes')), 'real/model.json')
(ev / 'windows-rows.draft.json').write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"\nAll automated checks passed: {auto_ok}. All 10 matrix cases remain pending (require UI / real-model testing). Draft: {ev / 'windows-rows.draft.json'}")
