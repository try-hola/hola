import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ControllableEventSource, eventSourceController, SSEEventCreators } from './mocks/controllable-eventsource';

describe('Controllable EventSource Mock', () => {
  beforeEach(() => {
    eventSourceController.reset();
  });

  afterEach(() => {
    eventSourceController.reset();
  });

  it('should create EventSource instances', () => {
    const eventSource = new ControllableEventSource('ws://test.com/stream');
    
    expect(eventSource).toBeDefined();
    expect(eventSource.url).toBe('ws://test.com/stream');
    expect(eventSource.readyState).toBe(0); // CONNECTING
    expect(eventSourceController.getInstances()).toHaveLength(1);
  });

  it('should simulate opening connection', () => {
    const eventSource = new ControllableEventSource('ws://test.com/stream');
    let openCalled = false;
    
    eventSource.onopen = () => {
      openCalled = true;
    };
    
    eventSource.simulateOpen();
    
    expect(openCalled).toBe(true);
    expect(eventSource.readyState).toBe(1); // OPEN
  });

  it('should simulate message events', () => {
    const eventSource = new ControllableEventSource('ws://test.com/stream');
    const receivedMessages: string[] = [];
    
    eventSource.onopen = () => {
      // Connection opened
    };
    
    eventSource.onmessage = (event) => {
      receivedMessages.push(event.data);
    };
    
    eventSource.simulateOpen();
    eventSource.simulateMessage('test message 1');
    eventSource.simulateMessage('test message 2');
    
    expect(receivedMessages).toEqual(['test message 1', 'test message 2']);
  });

  it('should simulate errors', () => {
    const eventSource = new ControllableEventSource('ws://test.com/stream');
    let errorCalled = false;
    
    eventSource.onerror = () => {
      errorCalled = true;
    };
    
    eventSource.simulateError();
    
    expect(errorCalled).toBe(true);
    expect(eventSource.readyState).toBe(2); // CLOSED
  });

  it('should create proper SSE event data', () => {
    const logEventData = SSEEventCreators.log({
      message: 'Test message',
      level: 'info'
    });
    
    const parsed = JSON.parse(logEventData);
    expect(parsed.type).toBe('log');
    expect(parsed.data.message).toBe('Test message');
    expect(parsed.data.level).toBe('info');
    expect(parsed.data.service).toBe('test-service');
    expect(parsed.data.timestamp).toBeDefined();
  });

  it('should create job update events', () => {
    const jobEventData = SSEEventCreators.jobUpdate({
      jobId: 'test-job',
      status: 'running',
      progress: 50
    });
    
    const parsed = JSON.parse(jobEventData);
    expect(parsed.type).toBe('job_update');
    expect(parsed.data.jobId).toBe('test-job');
    expect(parsed.data.status).toBe('running');
    expect(parsed.data.progress).toBe(50);
  });

  it('should control multiple instances', () => {
    new ControllableEventSource('ws://test1.com/stream');
    new ControllableEventSource('ws://test2.com/stream');
    
    expect(eventSourceController.getInstances()).toHaveLength(2);
    
    // Simulate open for all
    eventSourceController.simulateOpenAll();
    
    const instances = eventSourceController.getInstances();
    expect(instances[0].readyState).toBe(1); // OPEN
    expect(instances[1].readyState).toBe(1); // OPEN
  });
});