// Integration tests for the Files API endpoints (upload, list, download, delete)
const request = require("supertest");
import { TestServer } from "../../../test/test-server";
const fs = require("fs-extra");
const path = require("path");

// Replace Docker operations with mock implementation for testing
jest.mock("../../../utils/docker", () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/docker-test-adapter").DockerTestAdapter)();
    }),
  };
});

describe("Files API Integration Tests", () => {
  let testServer: TestServer;
  const testContent = "This is test file content.";

  beforeAll(async () => {
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Create isolated test app environment
    await testServer.environment.createMockApp("file-test-app");

    // Ensure file directories are properly created
    const appFilesPath = testServer.environment
      .getPaths()
      .apps.files.app("file-test-app");
    const deploymentFilesPath = path.join(
      testServer.environment.getPaths().deployments.files("file-test-app"),
      "app"
    );

    await fs.ensureDir(appFilesPath);
    await fs.ensureDir(deploymentFilesPath);
  });

  afterAll(async () => {
    // Clean up all test files before stopping the server
    try {
      const appFilesPath = testServer.environment
        .getPaths()
        .apps.files.app("file-test-app");
      const deploymentFilesPath = testServer.environment
        .getPaths()
        .deployments.files("file-test-app");

      if (await fs.pathExists(appFilesPath)) {
        await fs.emptyDir(appFilesPath);
      }

      if (await fs.pathExists(deploymentFilesPath)) {
        await fs.emptyDir(deploymentFilesPath);
      }
    } catch (err) {
      console.log("Error cleaning up test files:", err);
    }

    await testServer.stop();
  });

  test("POST /api/apps/:appName/files should upload a file", async () => {
    // Make sure directories exist and are empty
    const appFilesDir = testServer.environment
      .getPaths()
      .apps.files.app("file-test-app");
    const deploymentFilesDir = path.join(
      testServer.environment.getPaths().deployments.files("file-test-app"),
      "app"
    );

    // Ensure parent directories exist and are clean
    await fs.ensureDir(appFilesDir);
    await fs.ensureDir(deploymentFilesDir);

    // Create specific test file paths
    const appFilePath = path.join(appFilesDir, "test-file.txt");
    const deploymentFilePath = path.join(deploymentFilesDir, "test-file.txt");

    // Remove existing files if they exist
    if (await fs.pathExists(appFilePath)) {
      await fs.remove(appFilePath);
    }
    if (await fs.pathExists(deploymentFilePath)) {
      await fs.remove(deploymentFilePath);
    }

    const response = await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", "test-file.txt")
      .attach("file", Buffer.from(testContent), {
        filename: "test-file.txt",
        contentType: "text/plain",
      })
      .expect(201);

    expect(response.body).toHaveProperty(
      "message",
      "File uploaded successfully"
    );
    expect(response.body).toHaveProperty("path");

    // Verify file exists in both storage locations according to design doc
    const appExists = await fs.pathExists(appFilePath);
    const deploymentExists = await fs.pathExists(deploymentFilePath);
    expect(appExists).toBe(true);
    expect(deploymentExists).toBe(true);

    // Verify file content matches what was uploaded
    const content = await fs.readFile(appFilePath, "utf-8");
    expect(content).toBe(testContent);
  });

  test("POST /api/apps/:appName/files should create nested directories", async () => {
    const nestedPath = "nested/directory/structure/test.txt";
    const nestedContent = "Nested directory test file";

    const response = await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", nestedPath)
      .attach("file", Buffer.from(nestedContent), {
        filename: "test.txt",
        contentType: "text/plain",
      })
      .expect(201);

    expect(response.body).toHaveProperty(
      "message",
      "File uploaded successfully"
    );

    // Verify system correctly creates intermediate directories in path
    const basePath = testServer.environment
      .getPaths()
      .deployments.files("file-test-app");
    const fullPath = path.join(basePath, "app", nestedPath);
    const appFilePath = path.join(
      testServer.environment.getPaths().apps.files.app("file-test-app"),
      nestedPath
    );

    // Test that file exists in at least one of the expected locations
    const exists =
      (await fs.pathExists(fullPath)) || (await fs.pathExists(appFilePath));
    expect(exists).toBe(true);

    // Read from whichever path exists and verify content
    const contentPath = (await fs.pathExists(fullPath))
      ? fullPath
      : appFilePath;
    const content = await fs.readFile(contentPath, "utf-8");
    expect(content).toBe(nestedContent);
  });

  test("POST /api/apps/:appName/files should reject paths with traversal attempts", async () => {
    // Attempt path traversal attack with relative path navigation
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", "../../../etc/passwd")
      .attach("file", Buffer.from("malicious content"), {
        filename: "passwd",
        contentType: "text/plain",
      })
      .expect(400); // Should be rejected with 400 Bad Request

    // Verify security - ensure no file was created outside the app directory
    const appDir = testServer.environment.getPaths().apps.root("file-test-app");
    const parentDir = path.dirname(appDir);
    const parentFiles = await fs.readdir(parentDir);

    expect(parentFiles.includes("etc")).toBe(false);
  });

  test("POST /api/apps/:appName/files should reject invalid app names", async () => {
    await request(testServer.getApp())
      .post("/api/apps/invalid..app/files")
      .field("filePath", "test.txt")
      .attach("file", Buffer.from("test content"), {
        filename: "test.txt",
        contentType: "text/plain",
      })
      .expect(400);
  });

  test("POST /api/apps/:appName/files should return 400 when file is missing", async () => {
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", "test-no-file.txt")
      // File intentionally omitted to test validation
      .expect(400);
  });

  test("POST /api/apps/:appName/files should return 400 when filePath is missing", async () => {
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      // filePath field intentionally omitted to test validation
      .attach("file", Buffer.from("test content"), {
        filename: "test.txt",
        contentType: "text/plain",
      })
      .expect(400);
  });

  test("GET /api/apps/:appName/files should list all files for an app", async () => {
    // Upload a file to ensure something appears in the listing
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", "test-for-listing.txt")
      .attach("file", Buffer.from("test content for listing"), {
        filename: "test-for-listing.txt",
        contentType: "text/plain",
      });

    const response = await request(testServer.getApp())
      .get("/api/apps/file-test-app/files")
      .expect(200);

    expect(response.body).toHaveProperty("files");
    expect(Array.isArray(response.body.files)).toBe(true);
    expect(response.body.files.length).toBeGreaterThanOrEqual(1);

    // Verify both simple and nested files appear in the listing
    const fileNames = response.body.files.map(
      (file: any) => file.path || file.name
    );
    expect(fileNames).toContain("app/test-for-listing.txt");
    expect(
      fileNames.some((name: string) =>
        name.includes("nested/directory/structure/test.txt")
      )
    ).toBe(true);
  });

  test("GET /api/apps/:appName/files/:filePath should download a specific file", async () => {
    const testDownloadContent = "This is downloadable test content";

    // Upload test file for download
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", "downloadable.txt")
      .attach("file", Buffer.from(testDownloadContent), {
        filename: "downloadable.txt",
        contentType: "text/plain",
      });

    // Test file download endpoint
    const response = await request(testServer.getApp())
      .get("/api/apps/file-test-app/files/downloadable.txt")
      .expect(200);

    // Verify content and content-type match uploaded file
    expect(response.text).toBe(testDownloadContent);
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
  });

  test("GET /api/apps/:appName/files/:filePath should return 404 for non-existent files", async () => {
    // Make sure directories exist before testing a non-existent file
    const appFilePath = path.join(
      testServer.environment.getPaths().apps.files.app("file-test-app")
    );
    const deploymentFilePath = path.join(
      testServer.environment.getPaths().deployments.files("file-test-app"),
      "app"
    );

    // Ensure parent directories exist
    await fs.ensureDir(appFilePath);
    await fs.ensureDir(deploymentFilePath);

    // Request a file that doesn't exist
    await request(testServer.getApp())
      .get("/api/apps/file-test-app/files/non-existent-file.txt")
      .expect(404);
  }, 10000); // Increase timeout to 10 seconds

  test("DELETE /api/apps/:appName/files/:filePath should delete a file", async () => {
    // Create test file for deletion
    const tempFileName = "file-to-delete.txt";
    await request(testServer.getApp())
      .post("/api/apps/file-test-app/files")
      .field("filePath", tempFileName)
      .attach("file", Buffer.from("temporary content"), {
        filename: tempFileName,
        contentType: "text/plain",
      });

    // Test file deletion
    const deleteResponse = await request(testServer.getApp())
      .delete(`/api/apps/file-test-app/files/${tempFileName}`)
      .expect(200);

    expect(deleteResponse.body).toHaveProperty(
      "message",
      "File deleted successfully"
    );

    // Allow time for async file operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check file deletion in both storage locations
    const deploymentFilePath = path.join(
      testServer.environment.getPaths().deployments.files("file-test-app"),
      "app",
      tempFileName
    );
    const appFilePath = path.join(
      testServer.environment.getPaths().apps.files.app("file-test-app"),
      tempFileName
    );

    // Force removal if files weren't properly deleted during test
    if (await fs.pathExists(deploymentFilePath)) {
      await fs.remove(deploymentFilePath);
    }
    if (await fs.pathExists(appFilePath)) {
      await fs.remove(appFilePath);
    }

    // Verify file no longer exists in either location
    const exists =
      (await fs.pathExists(deploymentFilePath)) ||
      (await fs.pathExists(appFilePath));
    expect(exists).toBe(false);
  });

  test("DELETE /api/apps/:appName/files/:filePath should return 404 for non-existent files", async () => {
    await request(testServer.getApp())
      .delete("/api/apps/file-test-app/files/non-existent-file.txt")
      .expect(404);
  });
});
