import type { RequestHandler } from "express";
import { sendUpdate } from "../utils/updates";
import { runDockerCommand } from "../utils/docker";

export const deployApp: RequestHandler = (req, res) => {
  const { appName } = req.body;
  if (!appName) {
    res.status(400).json({ error: "App name is required" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Run Docker Compose Up
  runDockerCommand(res, "DEPLOY", ["up", "-d"], appName, false);
};

export const upgradeApp: RequestHandler = (req, res) => {
  const { appName } = req.params;
  res.json({ message: `Upgrading ${appName}...` });
};
