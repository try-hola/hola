#!/bin/bash

# run_tests.sh
# Combined script to run tests for the Hola project
# Usage: ./run_tests.sh [package_name] [optional pytest arguments]
# If no package name is provided, all tests are run

set -e  # Exit immediately if a command exits with a non-zero status

# Function to run tests for a specific package
run_package_tests() {
  local package=$1
  shift
  echo "Running tests for $package..."
  poetry run pytest "$package/tests/" "$@"
  echo "Tests completed for $package"
  echo ""
}

# Main execution logic
if [ "$1" == "" ]; then
  echo "Running all tests for Hola project"
  echo "=================================="
  echo ""
  
  # Run tests for each package
  run_package_tests "hola_server" "$@"
  run_package_tests "hola_cli" "$@"
  run_package_tests "hola_shared" "$@"
  
  echo "Running integration tests..."
  poetry run pytest integration_tests/ "$@"
  echo ""
  
  echo "All tests completed successfully!"
else
  # Run tests for the specified package
  package=$1
  shift
  
  # Check if it's integration tests
  if [ "$package" == "integration" ] || [ "$package" == "integration_tests" ]; then
    echo "Running integration tests..."
    poetry run pytest integration_tests/ "$@"
    echo "Integration tests completed"
  else
    run_package_tests "$package" "$@"
  fi
fi
