/**
 * WebAssembly Crypto Service
 *
 * Provides WASM-accelerated cryptographic operations for performance-critical tasks.
 * Falls back to native Node.js crypto when WASM is not available.
 */

import * as crypto from "crypto";
import { logger } from "@/lib/logger";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface HashResult {
  algorithm: string;
  digest: string;
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: string;
}

class WasmCryptoService {
  private wasmModule: WebAssembly.Instance | null = null;
  private initialized = false;

  /**
   * Initialize the WASM crypto module
   */
  async initialize(): Promise<void> {
    try {
      // Try to load WASM module if available
      // For now, we'll use native crypto but structure it for future WASM integration
      this.initialized = true;
      logger.info("WASM crypto service initialized (using native fallback)");
    } catch (error) {
      logger.warn("WASM module not available, using native crypto", { error });
      this.initialized = true;
    }
  }

  /**
   * Generate Ed25519 SSH key pair
   */
  generateEd25519KeyPair(comment?: string): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Convert to OpenSSH format
    const sshPublicKey = this.convertToOpenSSHPublicKey(publicKey, "ed25519", comment);
    const sshPrivateKey = this.convertToOpenSSHPrivateKey(privateKey, "ed25519");
    const fingerprint = this.calculateFingerprint(publicKey);

    return {
      publicKey: sshPublicKey,
      privateKey: sshPrivateKey,
      fingerprint,
    };
  }

  /**
   * Generate RSA SSH key pair
   */
  generateRSAKeyPair(bits: number = 4096, comment?: string): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: bits,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const sshPublicKey = this.convertToOpenSSHPublicKey(publicKey, "rsa", comment);
    const fingerprint = this.calculateFingerprint(publicKey);

    return {
      publicKey: sshPublicKey,
      privateKey,
      fingerprint,
    };
  }

  /**
   * Generate ECDSA SSH key pair
   */
  generateECDSAKeyPair(curve: "P-256" | "P-384" | "P-521" = "P-256", comment?: string): KeyPair {
    const namedCurve = curve === "P-256" ? "prime256v1" : curve === "P-384" ? "secp384r1" : "secp521r1";

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const sshPublicKey = this.convertToOpenSSHPublicKey(publicKey, `ecdsa-${curve}`, comment);
    const fingerprint = this.calculateFingerprint(publicKey);

    return {
      publicKey: sshPublicKey,
      privateKey,
      fingerprint,
    };
  }

  /**
   * Convert PEM public key to OpenSSH format
   */
  private convertToOpenSSHPublicKey(pemKey: string, type: string, comment?: string): string {
    const keyObject = crypto.createPublicKey(pemKey);
    const sshPublicKey = keyObject.export({ type: "spki", format: "der" });
    const base64Key = sshPublicKey.toString("base64");

    let keyType: string;
    switch (type) {
      case "ed25519":
        keyType = "ssh-ed25519";
        break;
      case "rsa":
        keyType = "ssh-rsa";
        break;
      case "ecdsa-P-256":
        keyType = "ecdsa-sha2-nistp256";
        break;
      case "ecdsa-P-384":
        keyType = "ecdsa-sha2-nistp384";
        break;
      case "ecdsa-P-521":
        keyType = "ecdsa-sha2-nistp521";
        break;
      default:
        keyType = "ssh-rsa";
    }

    return `${keyType} ${base64Key}${comment ? ` ${comment}` : ""}`;
  }

  /**
   * Convert PEM private key to OpenSSH format
   */
  private convertToOpenSSHPrivateKey(pemKey: string, type: string): string {
    // For Ed25519, we need proper OpenSSH format
    // This is a simplified version; in production, use ssh-keygen or a proper library
    return pemKey;
  }

  /**
   * Calculate SSH key fingerprint
   */
  calculateFingerprint(publicKey: string): string {
    const keyObject = crypto.createPublicKey(publicKey);
    const der = keyObject.export({ type: "spki", format: "der" });
    const hash = crypto.createHash("sha256").update(der).digest("base64");
    return `SHA256:${hash.replace(/=+$/, "")}`;
  }

  /**
   * Hash data with specified algorithm
   */
  hash(data: string | Buffer, algorithm: "sha256" | "sha384" | "sha512" = "sha256"): HashResult {
    const hash = crypto.createHash(algorithm);
    hash.update(data);
    return {
      algorithm,
      digest: hash.digest("hex"),
    };
  }

  /**
   * Generate HMAC
   */
  hmac(
    data: string | Buffer,
    key: string | Buffer,
    algorithm: "sha256" | "sha384" | "sha512" = "sha256"
  ): string {
    const hmac = crypto.createHmac(algorithm, key);
    hmac.update(data);
    return hmac.digest("hex");
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encrypt(data: string, key: string | Buffer): EncryptedData {
    const iv = crypto.randomBytes(16);
    const keyBuffer = typeof key === "string" ? this.deriveKey(key) : key;

    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
    let ciphertext = cipher.update(data, "utf8", "base64");
    ciphertext += cipher.final("base64");
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      algorithm: "aes-256-gcm",
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decrypt(encrypted: EncryptedData, key: string | Buffer): string {
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const keyBuffer = typeof key === "string" ? this.deriveKey(key) : key;

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Derive key from password using PBKDF2
   */
  deriveKey(password: string, salt?: Buffer, iterations: number = 100000): Buffer {
    const saltBuffer = salt || crypto.randomBytes(16);
    return crypto.pbkdf2Sync(password, saltBuffer, iterations, 32, "sha256");
  }

  /**
   * Generate cryptographically secure random bytes
   */
  randomBytes(length: number): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Generate secure random string
   */
  randomString(length: number, charset?: string): string {
    const chars = charset || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.randomBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i]! % chars.length];
    }
    return result;
  }

  /**
   * Generate UUID v4
   */
  generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Constant-time string comparison (timing-attack safe)
   */
  secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Generate secure password
   */
  generatePassword(length: number = 32, options?: {
    uppercase?: boolean;
    lowercase?: boolean;
    numbers?: boolean;
    symbols?: boolean;
  }): string {
    const opts = {
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      ...options,
    };

    let charset = "";
    if (opts.uppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (opts.lowercase) charset += "abcdefghijklmnopqrstuvwxyz";
    if (opts.numbers) charset += "0123456789";
    if (opts.symbols) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";

    return this.randomString(length, charset);
  }

  /**
   * Validate SSH public key format
   */
  validateSSHPublicKey(key: string): boolean {
    const parts = key.trim().split(" ");
    if (parts.length < 2) return false;

    const validTypes = [
      "ssh-rsa",
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "ssh-dss",
    ];

    if (!validTypes.includes(parts[0]!)) return false;

    try {
      const decoded = Buffer.from(parts[1]!, "base64");
      return decoded.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Extract public key from private key
   */
  extractPublicKey(privateKeyPem: string): string {
    try {
      const privateKey = crypto.createPrivateKey(privateKeyPem);
      const publicKey = crypto.createPublicKey(privateKey);
      return publicKey.export({ type: "spki", format: "pem" }) as string;
    } catch (error) {
      throw new Error("Invalid private key format");
    }
  }

  /**
   * Sign data with private key
   */
  sign(data: string | Buffer, privateKeyPem: string, algorithm: string = "sha256"): string {
    const sign = crypto.createSign(algorithm);
    sign.update(data);
    return sign.sign(privateKeyPem, "base64");
  }

  /**
   * Verify signature with public key
   */
  verify(
    data: string | Buffer,
    signature: string,
    publicKeyPem: string,
    algorithm: string = "sha256"
  ): boolean {
    const verify = crypto.createVerify(algorithm);
    verify.update(data);
    return verify.verify(publicKeyPem, signature, "base64");
  }

  /**
   * Check if WASM acceleration is available
   */
  isWasmAccelerated(): boolean {
    return this.wasmModule !== null;
  }
}

export const wasmCryptoService = new WasmCryptoService();
