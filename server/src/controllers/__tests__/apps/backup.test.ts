const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

// Mock Docker and ORAS runners to avoid actual container operations
jest.mock("../../../utils/docker", () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/docker-test-adapter").DockerTestAdapter)();
    }),
  };
});

jest.mock("../../../utils/oras", () => {
  return {
    OrasRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/oras-test-adapter").OrasTestAdapter)();
    }),
  };
});

describe("App Backup API Tests", () => {
  let testServer: TestServer;

  beforeEach(async () => {
    // Create a fresh test server for each test to ensure isolation
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Create mock app environment for backup tests
    await testServer.environment.createMockApp("backup-test-app");
  });

  afterEach(async () => {
    await testServer.stop();
  });

  test("POST /api/apps/:appName/backup should create a backup", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/backup-test-app/backup")
      .expect(200);

    // Verify SSE response headers for real-time status updates
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");

    // Verify backup directory and metadata file were created
    const backupsRootDir = testServer.environment.getPaths().backups.root("backup-test-app");
    const backupDirs = await fs.readdir(backupsRootDir);
    expect(backupDirs.length).toBeGreaterThan(0);

    const latestBackupDir = path.join(backupsRootDir, backupDirs[backupDirs.length - 1]);
    const metadataPath = path.join(latestBackupDir, "metadata.json");
    const metadataExists = await fs.pathExists(metadataPath);
    expect(metadataExists).toBe(true);
  });

  test("GET /api/apps/:appName/backups should list all backups", async () => {
    // Create a backup to ensure something appears in the listing
    await request(testServer.getApp())
      .post("/api/apps/backup-test-app/backup")
      .expect(200);

    const response = await request(testServer.getApp())
      .get("/api/apps/backup-test-app/backups")
      .expect(200);

    expect(response.body).toHaveProperty("backups");
    expect(Array.isArray(response.body.backups)).toBe(true);
    expect(response.body.backups.length).toBeGreaterThan(0);
  });

  test("GET /api/apps/:appName/backup/:backupId should retrieve backup details", async () => {
    // Create a backup to retrieve details for
    await request(testServer.getApp())
      .post("/api/apps/backup-test-app/backup")
      .expect(200);

    const backupsRootDir = testServer.environment.getPaths().backups.root("backup-test-app");
    const backupDirs = await fs.readdir(backupsRootDir);
    const latestBackupId = backupDirs[backupDirs.length - 1];

    const response = await request(testServer.getApp())
      .get(`/api/apps/backup-test-app/backup/${latestBackupId}`)
      .expect(200);

    expect(response.body).toHaveProperty("timestamp");
    expect(response.body).toHaveProperty("appName", "backup-test-app");
    expect(response.body).toHaveProperty("backupType", "manual");
  });

  test("POST /api/apps/:appName/restore/:backupId should restore from a backup", async () => {
    // Create a backup to restore from
    await request(testServer.getApp())
      .post("/api/apps/backup-test-app/backup")
      .expect(200);

    const backupsRootDir = testServer.environment.getPaths().backups.root("backup-test-app");
    const backupDirs = await fs.readdir(backupsRootDir);
    const latestBackupId = backupDirs[backupDirs.length - 1];

    const response = await request(testServer.getApp())
      .post(`/api/apps/backup-test-app/restore/${latestBackupId}`)
      .expect(200);

    // Verify SSE response headers for real-time status updates
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");

    // Verify the application was restored successfully
    const currentDir = testServer.environment.getPaths().deployments.current("backup-test-app");
    const currentDirExists = await fs.pathExists(currentDir);
    expect(currentDirExists).toBe(true);
  });
});
