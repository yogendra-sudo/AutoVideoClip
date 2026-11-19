##############################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################################

The desktop client has only one packing route: python-build-standalone (PBS).
Back end source code, static ffmpeg/ffprobe all entered in the 0-bit, user machines** without the need to pre-install Python or ffmpeg****.

> Historical PyInstaller / prepare_resources routes (and corresponding 6+ CI workflows) have never successfully produced available packages, all of which have been removed.

## Build locally (MacOS Apple Silicon)

```bash
./scripts/build_macos_arm.sh
```

Product:
```
src-tauri/target/release/bundle/macos/
AutoVideoClip Desktop.app#Application Package (~550M)
- AutoVideoClip Desktop_1.0.0_aarch64.dmg #DMG Installer (~260M)
```

The following is a list of the most commonly used types of scripting techniques.

### Prioritize dependence

And then I'm going to go back to the original version.
|------|------|------|
And then I'm going to have to go back to the front.
Rust, stable, with a zero-point target.
| cargo-tauri | 2.x | `cargo install tauri-cli` |

The system ** does not need** to pre-install Python / ffmpeg Python script with portable version ** first build to download and cache to Python 0)

## CI / published by GitHub Actions)

The first is the same one, the second is the same one.

```bash
# Manually Trigger: Repository Page  Actions  "Desktop Build (macos arm64)"  Run workflow

# Or hit tag trigger and automatically hang DMG on GitHub Release:
git tag v1.0.0
git push origin v1.0.0
```

## Installed and run for the first time

DMG is an ad-hoc signature (not Apple certified), so:

1. Double-click DMG and drag the 0 to Applications
2. ** Open the right-click app for the first time → Select "Open"** to bypass Gatekeeper
3. The back end will automatically start and build a data directory in the 0-bar.

## Failure to fix

The command line runs directly to the app and looks at the back end of the output:
```bash
'/Applications/AutoVideoClip Desktop.app/Contents/MacOS/autovideoclip-desktop'
```
The first is the "C" and "C" respectively.

I'm not going to say anything.
|------|------|
So, what's the point of this?
The black screen on the front is not installed, and you can see the WebView control panel; it's usually a problem with packaging/resources.
The video processing failure confirms that the code exists and can be executed.
I'm going to build a failure and want to come back.

♪ ♪ The known limitations ♪

- Apple Silicon (arm64) only, and no Intel/Windows/Linux packages yet
- Ad-hoc Signature, unlicensed, first right-click
