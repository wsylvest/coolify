/**
 * WASM Crypto Service Tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { wasmCryptoService } from "@/server/services/wasm";

describe("WasmCryptoService", () => {
  beforeAll(async () => {
    await wasmCryptoService.initialize();
  });

  describe("generateEd25519KeyPair", () => {
    it("should generate valid Ed25519 key pair", () => {
      const keyPair = wasmCryptoService.generateEd25519KeyPair("test@coolify");

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.fingerprint).toMatch(/^SHA256:/);
    });
  });

  describe("generateRSAKeyPair", () => {
    it("should generate valid RSA key pair", () => {
      const keyPair = wasmCryptoService.generateRSAKeyPair(2048);

      expect(keyPair.publicKey).toContain("ssh-rsa");
      expect(keyPair.privateKey).toContain("-----BEGIN");
      expect(keyPair.fingerprint).toMatch(/^SHA256:/);
    });
  });

  describe("hash", () => {
    it("should hash data with SHA-256", () => {
      const result = wasmCryptoService.hash("test data", "sha256");

      expect(result.algorithm).toBe("sha256");
      expect(result.digest).toHaveLength(64); // SHA-256 is 32 bytes = 64 hex chars
    });

    it("should produce consistent hashes", () => {
      const hash1 = wasmCryptoService.hash("same input");
      const hash2 = wasmCryptoService.hash("same input");

      expect(hash1.digest).toBe(hash2.digest);
    });
  });

  describe("hmac", () => {
    it("should generate valid HMAC", () => {
      const hmac = wasmCryptoService.hmac("message", "secret-key");

      expect(hmac).toHaveLength(64); // SHA-256 HMAC
    });

    it("should produce different HMACs for different keys", () => {
      const hmac1 = wasmCryptoService.hmac("message", "key1");
      const hmac2 = wasmCryptoService.hmac("message", "key2");

      expect(hmac1).not.toBe(hmac2);
    });
  });

  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt data", () => {
      const plaintext = "secret message";
      const key = "encryption-key-for-testing";

      const encrypted = wasmCryptoService.encrypt(plaintext, key);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();

      const decrypted = wasmCryptoService.decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it("should fail decryption with wrong key", () => {
      const encrypted = wasmCryptoService.encrypt("secret", "key1");

      expect(() => wasmCryptoService.decrypt(encrypted, "key2")).toThrow();
    });
  });

  describe("randomBytes", () => {
    it("should generate random bytes of specified length", () => {
      const bytes1 = wasmCryptoService.randomBytes(32);
      const bytes2 = wasmCryptoService.randomBytes(32);

      expect(bytes1).toHaveLength(32);
      expect(bytes2).toHaveLength(32);
      expect(bytes1.equals(bytes2)).toBe(false);
    });
  });

  describe("randomString", () => {
    it("should generate random string of specified length", () => {
      const str = wasmCryptoService.randomString(20);

      expect(str).toHaveLength(20);
    });

    it("should use custom charset when provided", () => {
      const str = wasmCryptoService.randomString(10, "abc");

      expect(str).toHaveLength(10);
      expect(str).toMatch(/^[abc]+$/);
    });
  });

  describe("generatePassword", () => {
    it("should generate password with default options", () => {
      const password = wasmCryptoService.generatePassword(16);

      expect(password).toHaveLength(16);
    });

    it("should respect password options", () => {
      const password = wasmCryptoService.generatePassword(20, {
        uppercase: true,
        lowercase: true,
        numbers: false,
        symbols: false,
      });

      expect(password).toHaveLength(20);
      expect(password).toMatch(/^[A-Za-z]+$/);
    });
  });

  describe("secureCompare", () => {
    it("should return true for equal strings", () => {
      expect(wasmCryptoService.secureCompare("test", "test")).toBe(true);
    });

    it("should return false for different strings", () => {
      expect(wasmCryptoService.secureCompare("test", "Test")).toBe(false);
    });

    it("should return false for different length strings", () => {
      expect(wasmCryptoService.secureCompare("test", "testing")).toBe(false);
    });
  });

  describe("validateSSHPublicKey", () => {
    it("should validate correct SSH public key format", () => {
      const validKey =
        "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDZl3fD6LzuMYXk2e4Yf3n test@host";

      expect(wasmCryptoService.validateSSHPublicKey(validKey)).toBe(true);
    });

    it("should reject invalid SSH public key format", () => {
      expect(wasmCryptoService.validateSSHPublicKey("invalid key")).toBe(false);
      expect(wasmCryptoService.validateSSHPublicKey("ssh-rsa")).toBe(false);
    });
  });

  describe("sign/verify", () => {
    it("should sign and verify data", () => {
      const keyPair = wasmCryptoService.generateRSAKeyPair(2048);
      const publicKeyPem = wasmCryptoService.extractPublicKey(keyPair.privateKey);
      const data = "data to sign";

      const signature = wasmCryptoService.sign(data, keyPair.privateKey);
      expect(signature).toBeDefined();

      const isValid = wasmCryptoService.verify(data, signature, publicKeyPem);
      expect(isValid).toBe(true);
    });

    it("should fail verification with tampered data", () => {
      const keyPair = wasmCryptoService.generateRSAKeyPair(2048);
      const publicKeyPem = wasmCryptoService.extractPublicKey(keyPair.privateKey);

      const signature = wasmCryptoService.sign("original data", keyPair.privateKey);
      const isValid = wasmCryptoService.verify("tampered data", signature, publicKeyPem);

      expect(isValid).toBe(false);
    });
  });
});
