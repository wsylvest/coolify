import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/server/db";
import { s3Storages } from "@/server/db/schema/advanced";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { Readable } from "stream";

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  pathPrefix?: string;
  forcePathStyle?: boolean;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: "private" | "public-read";
}

class S3StorageService {
  /**
   * Create an S3 client from configuration
   */
  private createClient(config: S3Config): S3Client {
    return new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
    });
  }

  /**
   * Get full key with prefix
   */
  private getKey(config: S3Config, key: string): string {
    if (config.pathPrefix) {
      return `${config.pathPrefix.replace(/\/$/, "")}/${key}`;
    }
    return key;
  }

  /**
   * Test S3 connection
   */
  async testConnection(config: S3Config): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.createClient(config);
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("S3 connection test failed", { error, config: { ...config, secretKey: "***" } });
      return { success: false, error: message };
    }
  }

  /**
   * Upload a file to S3
   */
  async upload(
    config: S3Config,
    key: string,
    body: Buffer | Readable | string,
    options: UploadOptions = {}
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullKey = this.getKey(config, key);

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: fullKey,
          Body: body,
          ContentType: options.contentType,
          Metadata: options.metadata,
          ACL: options.acl,
        })
      );

      const url = `${config.endpoint}/${config.bucket}/${fullKey}`;

      logger.info("File uploaded to S3", { bucket: config.bucket, key: fullKey });

      return { success: true, url };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("S3 upload failed", { error, key });
      return { success: false, error: message };
    }
  }

  /**
   * Download a file from S3
   */
  async download(
    config: S3Config,
    key: string
  ): Promise<{ success: boolean; data?: Buffer; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullKey = this.getKey(config, key);

      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: fullKey,
        })
      );

      if (!response.Body) {
        return { success: false, error: "Empty response body" };
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);

      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("S3 download failed", { error, key });
      return { success: false, error: message };
    }
  }

  /**
   * Delete a file from S3
   */
  async delete(
    config: S3Config,
    key: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullKey = this.getKey(config, key);

      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: fullKey,
        })
      );

      logger.info("File deleted from S3", { bucket: config.bucket, key: fullKey });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("S3 delete failed", { error, key });
      return { success: false, error: message };
    }
  }

  /**
   * List files in S3
   */
  async list(
    config: S3Config,
    prefix?: string,
    maxKeys = 1000
  ): Promise<{ success: boolean; files?: { key: string; size: number; lastModified: Date }[]; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullPrefix = prefix ? this.getKey(config, prefix) : config.pathPrefix;

      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: fullPrefix,
          MaxKeys: maxKeys,
        })
      );

      const files = (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? "",
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
      }));

      return { success: true, files };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("S3 list failed", { error, prefix });
      return { success: false, error: message };
    }
  }

  /**
   * Generate a presigned URL for download
   */
  async getPresignedDownloadUrl(
    config: S3Config,
    key: string,
    expiresIn = 3600
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullKey = this.getKey(config, key);

      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: fullKey,
      });

      const url = await getSignedUrl(client, command, { expiresIn });

      return { success: true, url };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to generate presigned URL", { error, key });
      return { success: false, error: message };
    }
  }

  /**
   * Generate a presigned URL for upload
   */
  async getPresignedUploadUrl(
    config: S3Config,
    key: string,
    contentType: string,
    expiresIn = 3600
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const client = this.createClient(config);
      const fullKey = this.getKey(config, key);

      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: fullKey,
        ContentType: contentType,
      });

      const url = await getSignedUrl(client, command, { expiresIn });

      return { success: true, url };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to generate presigned upload URL", { error, key });
      return { success: false, error: message };
    }
  }

  /**
   * Get S3 config from storage ID
   */
  async getConfigFromStorage(storageId: string): Promise<S3Config | null> {
    const storage = await db.query.s3Storages.findFirst({
      where: eq(s3Storages.id, storageId),
    });

    if (!storage) {
      return null;
    }

    return {
      endpoint: storage.endpoint,
      bucket: storage.bucket,
      region: storage.region ?? "us-east-1",
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
      pathPrefix: storage.pathPrefix ?? undefined,
      forcePathStyle: storage.forcePathStyle ?? false,
    };
  }

  /**
   * Upload database backup to S3
   */
  async uploadBackup(
    storageId: string,
    backupName: string,
    data: Buffer,
    databaseName: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    const config = await this.getConfigFromStorage(storageId);
    if (!config) {
      return { success: false, error: "Storage configuration not found" };
    }

    const key = `backups/${databaseName}/${backupName}`;
    return this.upload(config, key, data, {
      contentType: "application/gzip",
      metadata: {
        "x-coolify-database": databaseName,
        "x-coolify-backup-date": new Date().toISOString(),
      },
    });
  }

  /**
   * List backups for a database
   */
  async listBackups(
    storageId: string,
    databaseName: string
  ): Promise<{ success: boolean; backups?: { key: string; size: number; lastModified: Date }[]; error?: string }> {
    const config = await this.getConfigFromStorage(storageId);
    if (!config) {
      return { success: false, error: "Storage configuration not found" };
    }

    const result = await this.list(config, `backups/${databaseName}/`);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      backups: result.files,
    };
  }
}

export const s3StorageService = new S3StorageService();
