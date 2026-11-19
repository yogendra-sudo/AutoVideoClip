# Development Quick Start (Compatibility Entry)

The current source environment, Redis startup, and shutdown commands are maintained in [STARTUP_GUIDE.md](../STARTUP_GUIDE.md). For desktop installation, see [User Installation Guide](USER_INSTALLATION_GUIDE.en.md); for containers, see [DOCKER.md](DOCKER.en.md); for desktop packaging, see [BUILD_GUIDE.md](../BUILD_GUIDE.md).

Run `npm ci` for frontend dependencies in `frontend/`. Python dependencies are defined by the root `requirements.txt`. The root no longer maintains a separate Node/Tauri CLI dependency stack.
