#!/bin/bash

# Script to launch server, generate client SDK, and shutdown server
# Usage: ./generate_client_sdk.sh

set -e  # Exit on any error

# Configuration
SERVER_HOST="localhost"
SERVER_PORT="8000"
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}"
OPENAPI_URL="${SERVER_URL}/openapi.json"
SDK_OUTPUT_PATH="hola_client_sdk"
CONFIG_FILE="openapi-client-config.yaml"
MAX_WAIT_TIME=30  # Maximum time to wait for server startup (seconds)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if server is running
check_server() {
    curl -s -f "${SERVER_URL}/health" > /dev/null 2>&1
}

# Function to wait for server to be ready
wait_for_server() {
    print_status "Waiting for server to be ready at ${SERVER_URL}..."
    local count=0
    while [ $count -lt $MAX_WAIT_TIME ]; do
        if check_server; then
            print_success "Server is ready!"
            return 0
        fi
        sleep 1
        count=$((count + 1))
        if [ $((count % 5)) -eq 0 ]; then
            print_status "Still waiting... (${count}/${MAX_WAIT_TIME}s)"
        fi
    done
    print_error "Server failed to start within ${MAX_WAIT_TIME} seconds"
    return 1
}

# Function to cleanup background processes
cleanup() {
    if [ ! -z "$SERVER_PID" ]; then
        print_status "Shutting down server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        print_success "Server shut down"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Main execution
main() {
    print_status "Starting Hola server and client SDK generation process..."
    
    # Check if we're in the right directory
    if [ ! -f "pyproject.toml" ] || [ ! -d "hola_server" ]; then
        print_error "Please run this script from the project root directory"
        exit 1
    fi
    
    # Check if config file exists
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "Config file $CONFIG_FILE not found, proceeding without it"
        CONFIG_ARG=""
    else
        CONFIG_ARG="--config $CONFIG_FILE"
    fi
    
    # Start the FastAPI server in background
    print_status "Starting FastAPI server..."
    poetry run uvicorn hola_server.main:app --host $SERVER_HOST --port $SERVER_PORT &
    SERVER_PID=$!
    print_status "Server started with PID: $SERVER_PID"
    
    # Wait for server to be ready
    if ! wait_for_server; then
        print_error "Failed to start server"
        exit 1
    fi
    
    # Check if OpenAPI endpoint is accessible
    print_status "Checking OpenAPI endpoint..."
    if ! curl -s -f "$OPENAPI_URL" > /dev/null; then
        print_error "OpenAPI endpoint not accessible at $OPENAPI_URL"
        exit 1
    fi
    print_success "OpenAPI endpoint is accessible"
    
    # Generate the client SDK
    print_status "Generating client SDK from $OPENAPI_URL..."
    if poetry run openapi-python-client generate \
        --url "$OPENAPI_URL" \
        --output-path "$SDK_OUTPUT_PATH" \
        --overwrite \
        $CONFIG_ARG; then
        print_success "Client SDK generated successfully in $SDK_OUTPUT_PATH/"
    else
        print_error "Failed to generate client SDK"
        exit 1
    fi
    
    print_success "Process completed successfully!"
    print_status "The server will be shut down automatically..."
}

# Check if script is being sourced or executed
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
