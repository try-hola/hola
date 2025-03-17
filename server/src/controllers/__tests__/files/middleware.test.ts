import { describe, expect, test, jest } from "@jest/globals";
import multer from "multer";
import { setupFilesTestMocks } from "../utils/test-utils.js";

// Mock multer before importing the tested module
jest.mock("multer", () => {
  const mockMulter = jest.fn().mockReturnValue({
    single: jest.fn().mockReturnValue("mock-middleware")
  });
  
  // Add memoryStorage as a property of mockMulter (the function object)
  // not as a method on an instance created by calling mockMulter()
  return Object.assign(mockMulter, {
    memoryStorage: jest.fn().mockReturnValue("memory-storage")
  });
});

// Setup all other mocks
setupFilesTestMocks();

// Import the module under test
import { uploadFile } from "../../files.js";

describe("uploadFile middleware", () => {
  test("is configured correctly", () => {
    // Verify multer was configured correctly
    expect(multer).toHaveBeenCalledWith({ 
      storage: "memory-storage" 
    });
    
    // Verify the single middleware was created correctly
    expect(multer().single).toHaveBeenCalledWith("file");
    
    // Verify uploadFile is the middleware returned by multer
    expect(uploadFile).toBe("mock-middleware");
  });
});