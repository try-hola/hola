import type { Response } from "express";

export const sendUpdate = (res: Response, taskId: string, status: string, message: string, step?: number, totalSteps?: number) => {
    const update = { taskId, status, message, step, totalSteps, timestamp: new Date().toISOString() };
  
    console.log(`[TASK ${taskId}] [${status.toUpperCase()}] ${message}`); // Log to STDOUT
    res.write(`data: ${JSON.stringify(update)}\n\n`);
};