# AutoClip Dockerfile
# Multi-stage build to reduce image size

# Stage 1: Build the frontend
FROM node:18-slim AS frontend-builder

WORKDIR /app/frontend

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy frontend dependency files
COPY frontend/package*.json ./

# Install frontend dependencies, including devDependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./
# Vite reads the shared application version for the web build.
COPY src-tauri/tauri.conf.json /app/src-tauri/tauri.conf.json
# Frontend imports the shared provider presets, measured quality tiers, and the failure-code catalog.
COPY backend/presets/provider_presets.json /app/backend/presets/provider_presets.json
COPY backend/presets/provider_quality.json /app/backend/presets/provider_quality.json
COPY backend/core/event_catalog.json backend/core/failure_messages.json /app/backend/core/

# Build the frontend
RUN npm run build

# Stage 2: Build the backend
# yt-dlp no longer supports Python 3.9 (YouTube extraction on 3.9 falls back to the android client and is limited to 360p).
FROM python:3.11-slim AS backend-builder

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependency files
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Stage 3: Final image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app

# Create a non-root user
RUN groupadd -r autoclip && useradd -r -g autoclip autoclip

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Set the working directory
WORKDIR /app

# Copy files from build stages
COPY --from=backend-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-builder /usr/local/bin /usr/local/bin
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy project files
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY init_database.py ./
COPY env.example .env
COPY docker-entrypoint.sh ./

# Create required directories
RUN mkdir -p data/projects data/uploads data/temp data/output logs

# Set permissions
RUN chown -R autoclip:autoclip /app
RUN chmod +x *.sh
RUN chmod +x docker-entrypoint.sh
RUN chmod -R 755 data logs

# Switch to the non-root user
USER autoclip

# Expose ports
EXPOSE 8000 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health/ || exit 1

# Startup command
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
