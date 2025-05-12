#!/usr/bin/env python
"""
Test script to verify logging implementation in both client and server.

This script starts the server in debug mode, then runs several CLI commands
to see how logging is working in both components.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

# Set environment variables for debug logging
os.environ["LOG_LEVEL"] = "DEBUG"

# Define colors for output
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"

print(f"{YELLOW}=== Testing Hola Logging Implementation ==={RESET}")

# Get the project root directory
project_root = Path(__file__).parent.resolve()

# Start server in debug mode (in a new process)
print(f"{BLUE}Starting server in debug mode...{RESET}")
server_process = subprocess.Popen(
    ["python", "-m", "hola_server.main"],
    cwd=project_root,
    env={**os.environ, "LOG_LEVEL": "DEBUG"},
)

try:
    # Wait for server to start
    print(f"{BLUE}Waiting for server to initialize...{RESET}")
    time.sleep(3)
    
    # Run CLI commands
    print(f"\n{YELLOW}=== Running CLI Commands ==={RESET}")
    
    # Version command
    print(f"{BLUE}Running 'version' command...{RESET}")
    subprocess.run(
        ["python", "-m", "hola_cli.main", "version"],
        cwd=project_root,
        env={**os.environ, "LOG_LEVEL": "DEBUG"},
        check=True,
    )
    
    # Hello command
    print(f"\n{BLUE}Running 'hello greet' command...{RESET}")
    subprocess.run(
        ["python", "-m", "hola_cli.main", "hello", "greet", "Tester"],
        cwd=project_root,
        env={**os.environ, "LOG_LEVEL": "DEBUG"},
        check=True,
    )
    
    # Trigger an error
    print(f"\n{BLUE}Running command with error...{RESET}")
    subprocess.run(
        ["python", "-m", "hola_cli.main", "hello", "greet", "--server", "nonexistent"],
        cwd=project_root,
        env={**os.environ, "LOG_LEVEL": "DEBUG"},
    )
    
    print(f"\n{GREEN}All tests completed. Check the logs above to see how logging is working.{RESET}")
    print(f"{YELLOW}Notice how both CLI and server logging follow the same patterns.{RESET}")

finally:
    # Stop the server
    print(f"\n{BLUE}Stopping server...{RESET}")
    server_process.terminate()
    server_process.wait(timeout=5)
