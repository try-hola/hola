#!/bin/bash

# Hola Server - Production Configuration Script
# This script sets up and starts the Hola server with all real services enabled

set -e

echo "🚀 Starting Hola Server in Production Mode"
echo "================================================"

# Production Environment Variables
export NODE_ENV=production
export LOG_LEVEL=${LOG_LEVEL:-info}
export LOG_FORMAT=${LOG_FORMAT:-json}

# Optional production overrides
# export HOLA_USE_AUTH=true
# export HOLA_USE_OBSERVABILITY=true

# API Configuration
export PORT=${PORT:-3001}

# Storage Configuration
export HOLA_DATA_DIR=${HOLA_DATA_DIR:-"$HOME/.hola"}

# Docker Configuration  
export HOLA_DOCKER_HOST=${HOLA_DOCKER_HOST:-"unix:///var/run/docker.sock"}

echo "✅ Production Environment Configuration:"
echo "   Data Root: $HOLA_DATA_DIR"
echo "   Docker Host: $HOLA_DOCKER_HOST"
echo "   Server Port: $PORT"
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
if ! mkdir -p "$HOLA_DATA_DIR" 2>/dev/null; then
    echo "❌ Cannot create data directory: $HOLA_DATA_DIR"
    echo "   Please check permissions"
    exit 1
fi
echo "✅ Data directory accessible: $HOLA_DATA_DIR"

# Check if port is available
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ Port $PORT is already in use"
    echo "   Please stop the existing service or choose a different port"
    exit 1
fi
echo "✅ Port $PORT is available"

echo ""
echo "🎯 Starting Hola Server with Production Configuration..."
echo "   Production environment selects real services"
echo ""

# Start the server
exec bun run src/server.ts
