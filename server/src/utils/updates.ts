import type { Response } from "express";
import { logEvent } from "../utils/logger";

export const sendUpdate = (
  res: Response,
  taskId: string,
  taskType: string,
  status: string,
  message: string,
  step?: number,
  totalSteps?: number
) => {
  const update = { taskId, taskType, status, message, step, totalSteps, timestamp: new Date().toISOString() };

  logEvent("TASK", "progress", message, { taskId, taskType, step, totalSteps }); // Unified logging format
  res.write(`data: ${JSON.stringify(update)}\n\n`);
};