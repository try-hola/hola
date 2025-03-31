import { Response } from 'express';
import { logEvent } from './logger';

/**
 * Represents a task update that will be sent to the client
 */
interface TaskUpdate {
  /** Unique identifier for the task */
  taskId: string;
  /** Type of task being performed (e.g., "DEPLOY", "UPGRADE") */
  taskType: string;
  /** Current status of the task */
  status: 'starting' | 'running' | 'complete' | 'error' | string;
  /** Human-readable message about the current status */
  message: string;
  /** Current step number in the process (optional) */
  step?: number;
  /** Total number of steps in the process (optional) */
  totalSteps?: number;
  /** ISO timestamp when the update was created */
  timestamp: string;
}

/**
 * Send a Server-Sent Event (SSE) update to the client
 * 
 * @param res - Express response object
 * @param taskId - Unique ID for this task 
 * @param taskType - Type of task (DEPLOY, REMOVE, START, etc.)
 * @param status - Status of the task (starting, running, complete, error)
 * @param message - Message to send with the update
 */
export const sendUpdate = (
  res: Response,
  taskId: string,
  taskType: string,
  status: string,
  message: string
): void => {
  try {
    // Create SSE data object
    const data = {
      taskId,
      taskType,
      status,
      message,
      timestamp: new Date().toISOString()
    };
    
    // Format as SSE (each line needs to start with "data:")
    const sseFormattedData = `data: ${JSON.stringify(data)}\n\n`;
    
    // Log the event internally
    logEvent(taskType, status === 'error' ? 'error' : 'info', message);
    
    // Write to response stream
    res.write(sseFormattedData);
    
    // If this is a completion or error status, we might choose to end the stream
    if (status === 'complete' || status === 'error') {
      // But we'll let the caller decide when to end the stream
    }
  } catch (error) {
    console.error('Error sending SSE update:', error);
    
    // Try to send an error message
    try {
      const errorData = {
        taskId,
        taskType,
        status: 'error',
        message: 'Failed to send updates',
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    } catch {
      // We tried our best
    }
  }
};

// Export using CommonJS syntax
module.exports = { sendUpdate };