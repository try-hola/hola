# SSE Endpoints Implementation

This document describes the Server-Sent Events (SSE) implementation for real-time streaming in the Hola application.

## Implemented Endpoints

### 1. Job Logs SSE Stream
- **Endpoint**: `GET /api/jobs/:id/logs/stream`
- **Purpose**: Stream real-time logs and job status updates
- **Events**:
  - `log`: Log entries with timestamp, service, level, and message
  - `job_update`: Job status updates with progress and completion info
  - `heartbeat`: Keep-alive messages

### 2. Dev Session Events SSE Stream  
- **Endpoint**: `GET /api/dev/sessions/:id/events`
- **Purpose**: Stream real-time dev session status and activity
- **Events**:
  - `session_status`: Session state changes (starting, running, stopped)
  - `log`: Session-specific log messages
  - `heartbeat`: Keep-alive messages

## SSE Event Types

All events follow the `SSEEvent` union type from `@hola/shared`:

```typescript
export type SSEEvent = 
  | SSELogEvent 
  | SSEJobUpdateEvent 
  | SSESystemUpdateEvent 
  | SSEDeploymentUpdateEvent 
  | SSEDevSessionStatusEvent;
```

### Dev Session Status Events

```typescript
export type SSEDevSessionStatusEvent = {
  type: 'session_status';
  data: {
    sessionId: string;
    status: string;
    lastActivity: string;
    liveReload?: boolean;
    autoSync?: boolean;
    logs?: string[];
  };
};
```

## Implementation Details

### Server-Side (packages/server)

1. **SSE Helper Function**: `sse()` sets proper headers:
   - `content-type: text/event-stream`
   - `cache-control: no-cache`
   - `connection: keep-alive`

2. **Stream Management**: 
   - Uses `ReadableStream` for proper backpressure handling
   - Includes cleanup logic for connection close
   - Graceful error handling with fallback to mock data

3. **Monitoring Integration**:
   - Real services implement `startMonitoring()` method
   - Callback-based event emission
   - Automatic cleanup on stream close

### Client-Side (packages/web)

1. **SSE Hook**: `useSSE()` provides:
   - Connection state management
   - Event filtering by type
   - Automatic reconnection with exponential backoff
   - Heartbeat handling

2. **Test Infrastructure**:
   - `ControllableEventSource` for deterministic testing
   - `SSETestHelper` for common test patterns
   - Event creators for all SSE event types

## Testing Strategy

### Integration Tests (Server)
- **File**: `packages/server/src/__tests__/sse-endpoints-integration.test.ts`
- **Scope**: End-to-end SSE testing with running server
- **Features**:
  - Header validation
  - Event structure validation
  - Connection reliability testing
  - Fail-fast timeouts (15s test timeout, 8s SSE timeout)

### Unit Tests (Web)
- **File**: `packages/web/src/__tests__/dev-session-sse.test.tsx`
- **Scope**: Client-side SSE behavior testing
- **Features**:
  - Connection state management
  - Event filtering and processing
  - Error handling scenarios
  - Deterministic mock events

## Connection Management

### Fail-Fast Design
- Tests use reduced timeouts to prevent hanging in CI
- Server includes heartbeat messages to detect stale connections
- Client implements automatic reconnection with backoff

### Error Handling
- Server gracefully handles service failures with mock fallbacks
- Client maintains connection state and provides error information
- Both sides include proper cleanup on disconnect

### Production Considerations
- Connection pooling via EventSource standard behavior
- Resource cleanup on client disconnect
- Memory-efficient event streaming without buffering all events

## Usage Examples

### Server Implementation
```typescript
// Dev session events endpoint
const response = await fetch('/api/dev/sessions/session-123/events');
const reader = response.body.getReader();
// Process SSE events...
```

### Client Hook Usage
```typescript
const { connectionState, events, lastEvent } = useSSE(
  API.dev.events(sessionId),
  {
    reconnect: true,
    eventTypes: ['session_status', 'log'],
  }
);
```

### Test Helper Usage  
```typescript
// Setup controllable EventSource
const eventSourceFactory = SSETestHelper.setup();

// Send dev session event
await SSETestHelper.sendDevSessionStatusEvent({
  sessionId: 'test-session',
  status: 'running',
  liveReload: true,
});
```

## Feature Flags

The dev session events endpoint is gated behind the `enableDevApi` feature flag:
- Enabled in development and testing environments
- Can be disabled for production deployments
- Graceful degradation when disabled (returns 404 or skips endpoint)