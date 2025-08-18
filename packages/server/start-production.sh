#!/bin/bash

# Hola Server - Production Configuration Script
# This script sets up and starts the Hola server with all real services enabled

set -e

echo "🚀 Starting Hola Server in Production Mode"
echo "================================================"

# Production Environment Variables
export NODE_ENV=production
export HOLA_LOG_LEVEL=info
export HOLA_LOG_FORMAT=json

# Enable all real services for production
export HOLA_USE_REAL_STORAGE=true
export HOLA_USE_REAL_DOCKER=true  
export HOLA_USE_REAL_DATABASE=true
export HOLA_USE_REAL_JOBS=true
export HOLA_USE_REAL_CATALOG=true

# Enable Phase 7 real services
export HOLA_USE_REAL_DRAFTS=true
export HOLA_USE_REAL_VALIDATION=true
export HOLA_USE_REAL_DEPLOYMENTS=true
export HOLA_USE_REAL_DEV_SESSIONS=true

# Optional: Enable additional services
# export HOLA_USE_REAL_BUNDLES=true
# export HOLA_USE_REAL_BACKUPS=true
# export HOLA_USE_AUTH=true
# export HOLA_USE_OBSERVABILITY=true

# API Configuration
export HOLA_ENABLE_DEV_API=true
export HOLA_PORT=3001

# Storage Configuration
export HOLA_STORAGE_ROOT=${HOLA_STORAGE_ROOT:-"$HOME/.hola"}
export HOLA_DATABASE_PATH=${HOLA_DATABASE_PATH:-"$HOLA_STORAGE_ROOT/data/hola.db"}

# Docker Configuration  
export HOLA_DOCKER_HOST=${HOLA_DOCKER_HOST:-"unix:///var/run/docker.sock"}

echo "✅ Production Environment Configuration:"
echo "   Storage Root: $HOLA_STORAGE_ROOT"
echo "   Database: $HOLA_DATABASE_PATH" 
echo "   Docker Host: $HOLA_DOCKER_HOST"
echo "   Server Port: $HOLA_PORT"
echo ""

echo "🔍 Pre-flight Checks:"

# Check Docker availability
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not available or not running"
    echo "   Please ensure Docker is installed and running"
    exit 1
fi
echo "✅ Docker is available"

# Check storage directory permissions
if ! mkdir -p "$HOLA_STORAGE_ROOT" 2>/dev/null; then
    echo "❌ Cannot create storage directory: $HOLA_STORAGE_ROOT"
    echo "   Please check permissions"
    exit 1
fi
echo "✅ Storage directory accessible: $HOLA_STORAGE_ROOT"

# Check if port is available
if lsof -Pi :$HOLA_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ Port $HOLA_PORT is already in use"
    echo "   Please stop the existing service or choose a different port"
    exit 1
fi
echo "✅ Port $HOLA_PORT is available"

echo ""
echo "🎯 Starting Hola Server with Production Configuration..."
echo "   All real services enabled"
echo "   Phase 7 endpoints ready for production use"
echo "   Storage, Docker, Database, Jobs, and Catalog services active"
echo ""

# Start the server
exec bun run src/server.ts
