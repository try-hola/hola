const express = require('express');
const { logEvent } = require('../utils/logger');
const { Response } = require('express');

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

const sendUpdate = (
  res: any, // Using any as it's an SSE response with write method
  taskId: string,
  taskType: string,
  status: string,
  message: string,
  step?: number,
  totalSteps?: number
): void => {
  const update: TaskUpdate = { 
    taskId, 
    taskType, 
    status, 
    message, 
    step, 
    totalSteps, 
    timestamp: new Date().toISOString() 
  };

  logEvent("TASK", "progress", message, { taskId, taskType, step, totalSteps }); 
  res.write(`data: ${JSON.stringify(update)}\n\n`);
};

module.exports = {
  sendUpdate
};