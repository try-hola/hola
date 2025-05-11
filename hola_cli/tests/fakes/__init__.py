"""
Directory for fake implementations used in CLI tests.

This directory contains fake implementations of external dependencies and interfaces 
that are used in the CLI test suite. Fakes are preferred over mocks in this project's 
testing strategy because they:

1. Provide realistic behavior that follows the same interface as the real component
2. Allow tests to focus on behavior verification rather than implementation details
3. Make tests more stable when implementation details change
4. Enable more comprehensive testing of interaction patterns

Key fake implementations include:

1. FakeApiClient: An in-memory implementation of the API client interface that:
   - Allows pre-registering responses for specific endpoints
   - Records requests made during tests for later verification
   - Provides deterministic behavior without external dependencies

2. FakeServerContext: A test double for the server connection context that:
   - Maintains the same interface as the real server context
   - Provides access to a FakeApiClient for testing commands
   - Simulates server connection information like URLs and API keys

These fakes are especially important for testing at system boundaries, such as the
API client interface, where the CLI interacts with external systems. Using fakes
instead of mocks allows tests to verify that the correct requests are made without
depending on implementation details of how those requests are constructed.

The fakes in this directory are used throughout the test suite, particularly in
command and service tests that need to simulate server interactions.
"""
