const crypto = require("crypto");
const { logEvent } = require("./logger");

/**
 * Configuration for encryption operations
 */
interface EncryptionConfig {
  algorithm: string;
  ivLength: number;
  saltLength: number;
  keyLength: number;
  iterations: number;
}

// Default encryption configuration
const defaultConfig: EncryptionConfig = {
  algorithm: "aes-256-cbc",
  ivLength: 16, // For AES, this is always 16 bytes
  saltLength: 16,
  keyLength: 32, // 32 bytes = 256 bits
  iterations: 10000,
};

/**
 * Gets the encryption key from environment variables or creates a warning if not present
 *
 * @returns {Buffer} - The encryption key as a Buffer
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    logEvent(
      "SECURITY",
      "warning",
      "ENCRYPTION_KEY not set in environment variables, using fallback key. This is insecure for production!"
    );
    // Return a deterministic fallback key for development environments
    // This is obviously not secure for production, but allows the system to function in dev
    return crypto.pbkdf2Sync(
      "insecure-fallback-development-key-do-not-use-in-production",
      "fallback-salt",
      defaultConfig.iterations,
      defaultConfig.keyLength,
      "sha256"
    );
  }

  // Use the configured key
  return crypto.pbkdf2Sync(
    key,
    "static-salt", // This should ideally be unique per application in a production environment
    defaultConfig.iterations,
    defaultConfig.keyLength,
    "sha256"
  );
}

/**
 * Encrypts a string value
 *
 * @param {string} value - The value to encrypt
 * @returns {string} - The encrypted value as a base64-encoded string
 */
function encryptValue(value: string): string {
  try {
    const key = getEncryptionKey();

    // Create a random initialization vector
    const iv = crypto.randomBytes(defaultConfig.ivLength);

    // Create cipher with key and iv
    const cipher = crypto.createCipheriv(defaultConfig.algorithm, key, iv);

    // Update the cipher with data and get the encrypted output
    let encrypted = cipher.update(value, "utf8", "base64");
    encrypted += cipher.final("base64");

    // Combine IV and encrypted data with a delimiter
    // Format: base64(iv):base64(encrypted)
    return `${iv.toString("base64")}:${encrypted}`;
  } catch (error: any) {
    logEvent("SECURITY", "error", "Encryption failed", {
      error: error.message,
    });
    throw new Error("Failed to encrypt value");
  }
}

/**
 * Decrypts an encrypted string value
 *
 * @param {string} encryptedValue - The encrypted value (IV:encrypted format)
 * @returns {string} - The decrypted value as a string
 */
function decryptValue(encryptedValue: string): string {
  try {
    // Split the encrypted value into IV and data parts
    const [ivBase64, encryptedBase64] = encryptedValue.split(":");

    if (!ivBase64 || !encryptedBase64) {
      throw new Error("Invalid encrypted value format");
    }

    // Convert base64 strings back to buffers
    const iv = Buffer.from(ivBase64, "base64");
    const key = getEncryptionKey();

    // Create decipher
    const decipher = crypto.createDecipheriv(defaultConfig.algorithm, key, iv);

    // Decrypt the data
    let decrypted = decipher.update(encryptedBase64, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error: any) {
    logEvent("SECURITY", "error", "Decryption failed", {
      error: error.message,
    });
    throw new Error("Failed to decrypt value");
  }
}

/**
 * Tests if a string appears to be an encrypted value by checking format
 *
 * @param {string} value - The value to check
 * @returns {boolean} - True if the value appears to be encrypted
 */
function isEncrypted(value: string): boolean {
  // Simple check to see if the value follows our encryption format (IV:data)
  // This is not foolproof but helps identify encrypted values
  if (!value || typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");
  if (parts.length !== 2) {
    return false;
  }

  try {
    // Check if the first part is a valid base64 IV
    const iv = Buffer.from(parts[0], "base64");
    return iv.length === defaultConfig.ivLength;
  } catch {
    return false;
  }
}

// Export using CommonJS module syntax
module.exports = {
  encryptValue,
  decryptValue,
  isEncrypted,
};
