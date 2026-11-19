# Windows upgrade and post-install smoke test, shared by smoke-windows-x64 in desktop-build.yml and windows-install-smoke.yml.
#
#   pwsh scripts/windows_upgrade_smoke.ps1 -NewInstaller <newly-built setup.exe>
#
# 1. Silently install the previous release (GitHub latest release; GH_TOKEN is required).
# 2. Start a process with the installed python.exe that locks _asyncio.pyd to simulate a leftover backend (#224).
# 3. Silently upgrade to the new package. The installer must stop the process, remove stale resources\backend files,
#    install the new files, and preserve user data.
# 4. Run scripts/verify_windows_install.py with the bundled Python.
param(
  [Parameter(Mandatory = $true)][string]$NewInstaller,
  [string]$Report = 'windows-smoke.json'
)
$ErrorActionPreference = 'Stop'
$repo = $env:GITHUB_REPOSITORY

function Get-InstallDir {
  $key = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall |
    Get-ItemProperty | Where-Object DisplayName -like 'AutoClip*' | Select-Object -First 1
  if (-not $key) { throw 'Could not find the AutoClip installation in the registry.' }
  # NSIS stores InstallLocation with quotes, for example "C:\Users\<user>\AppData\Local\AutoClip Desktop".
  $dir = ($key.InstallLocation -replace '"', '').TrimEnd('\')
  if (-not $dir) { $dir = Split-Path ($key.UninstallString -replace '"', '') }
  if (-not (Test-Path (Join-Path $dir 'resources\python\python.exe'))) {
    throw "Could not find resources\python\python.exe in the install directory: $dir"
  }
  return @{ Dir = $dir; Version = $key.DisplayVersion }
}

Write-Host '==> Installing the previous release'
$prev = gh release view --repo $repo --json tagName -q .tagName
gh release download $prev --repo $repo --pattern '*x64-setup.exe' --dir old --clobber
$old = Get-ChildItem old\*x64-setup.exe | Select-Object -First 1
$p = Start-Process $old.FullName -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Previous release $prev installation failed: $($p.ExitCode)" }
$install = Get-InstallDir
Write-Host "Installed previous release $prev to $($install.Dir) ($($install.Version))"

Write-Host '==> Creating markers for stale backend source and user data'
# An upgrade must remove source files deleted from the current version's resources\backend (RC156 Win QA #2)
# without touching user data under %APPDATA%\AutoClip.
$staleMarker = Join-Path $install.Dir 'resources\backend\stale_marker.py'
Set-Content -Path $staleMarker -Value '# stale file from the previous version' -Encoding utf8
$userData = Join-Path $env:APPDATA 'AutoClip'
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$userMarker = Join-Path $userData 'upgrade_smoke_user_marker.txt'
Set-Content -Path $userMarker -Value 'user data must survive the upgrade' -Encoding utf8

Write-Host '==> Simulating a leftover backend process locking _asyncio.pyd'
$py = Join-Path $install.Dir 'resources\python\python.exe'
$lock = Start-Process $py -ArgumentList '-c', '"import asyncio, time; time.sleep(900)"' -PassThru -WindowStyle Hidden
Start-Sleep 3
if ($lock.HasExited) { throw 'The simulated leftover process did not start.' }
Write-Host "Leftover python.exe PID=$($lock.Id)"

Write-Host '==> Silently upgrading to the new package'
$p = Start-Process (Resolve-Path $NewInstaller).Path -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Upgrade failed: $($p.ExitCode)" }
if (Get-Process -Id $lock.Id -ErrorAction SilentlyContinue) {
  Stop-Process -Id $lock.Id -Force
  throw 'The installer did not stop the leftover python.exe.'
}
$install = Get-InstallDir
$marker = Join-Path $install.Dir 'resources\backend\core\local_origin_guard.py'
if (-not (Test-Path $marker)) { throw 'The old file remains after upgrade; the new version was not installed.' }
if (Test-Path $staleMarker) { throw 'Stale files remain in resources\backend after the upgrade.' }
if (-not (Test-Path $userMarker)) { throw 'The upgrade deleted user data under %APPDATA%\AutoClip.' }
Remove-Item $userMarker -Force
Write-Host "Successfully upgraded from $prev to $($install.Version); the installer stopped the leftover process."

Write-Host '==> Running the post-install runtime smoke test'
$res = Join-Path $install.Dir 'resources'
# Force UTF-8 as the desktop app does when starting the backend; non-ASCII output otherwise fails in cp1252 consoles.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
& (Join-Path $res 'python\python.exe') -B scripts\verify_windows_install.py --resources $res --report $Report --launch-desktop
if ($LASTEXITCODE -ne 0) { throw "Post-install smoke test failed: $LASTEXITCODE" }

Write-Host '==> Verifying bundled SenseVoice components and real offline transcription'
& (Join-Path $res 'python\python.exe') -B scripts\verify_sensevoice.py --resources $res --report windows-sensevoice-installed.json
if ($LASTEXITCODE -ne 0) { throw "Bundled SenseVoice verification failed: $LASTEXITCODE" }

Write-Host '==> Verifying bundled Whisper components and actual C++ DLL load locations'
& (Join-Path $res 'python\python.exe') -B scripts\verify_whisper_recovery.py --resources $res --report windows-whisper-installed.json
if ($LASTEXITCODE -ne 0) { throw "Bundled Whisper verification failed: $LASTEXITCODE" }
