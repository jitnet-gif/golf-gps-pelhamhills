/**
 * Cloudflare R2 Upload Script
 * Bulk uploads tiles to R2 with CDN URL generation
 * Supports parallel processing and resumable uploads
 */

import * as fs from "fs";
import * as path from "path";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  accessKeySecret: string;
  bucketName: string;
  cdnDomain?: string; // Custom domain or R2 domain
  region?: string;
}

interface UploadResult {
  success: number;
  failed: number;
  skipped: number;
  totalSize: number;
  duration: number;
  cdnUrls: string[];
}

class R2Uploader {
  private client: S3Client;
  private config: R2Config;
  private baseUrl: string;

  constructor(config: R2Config) {
    this.config = config;

    // Initialize S3 client for R2
    this.client = new S3Client({
      region: config.region || "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.accessKeySecret,
      },
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    });

    // Build base CDN URL
    this.baseUrl =
      config.cdnDomain ||
      `https://${config.bucketName}.cdn.jsdelivr.net`;
  }

  /**
   * Upload a single file to R2
   */
  async uploadFile(
    localPath: string,
    remoteKey: string,
    checksum?: string
  ): Promise<{
    success: boolean;
    key: string;
    url: string;
    size: number;
    error?: string;
  }> {
    try {
      const fileStats = fs.statSync(localPath);
      const fileStream = fs.createReadStream(localPath);

      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucketName,
          Key: remoteKey,
          Body: fileStream,
          ContentType: this.getContentType(localPath),
          Metadata: {
            "uploaded-at": new Date().toISOString(),
            checksum: checksum || "",
          },
        },
      });

      // Progress tracking
      upload.on("httpUploadProgress", (progress) => {
        const percent = ((progress.loaded || 0) / fileStats.size) * 100;
        console.log(
          `   ⬆️  ${remoteKey}: ${percent.toFixed(1)}% (${((progress.loaded || 0) / 1024 / 1024).toFixed(2)}MB)`
        );
      });

      await upload.done();

      const cdnUrl = `${this.baseUrl}/${remoteKey}`;

      return {
        success: true,
        key: remoteKey,
        url: cdnUrl,
        size: fileStats.size,
      };
    } catch (error) {
      return {
        success: false,
        key: remoteKey,
        url: "",
        size: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upload tiles from directory
   */
  async uploadTiles(
    tileDir: string,
    courseId: string,
    concurrency: number = 5
  ): Promise<UploadResult> {
    const startTime = Date.now();
    const results: UploadResult = {
      success: 0,
      failed: 0,
      skipped: 0,
      totalSize: 0,
      duration: 0,
      cdnUrls: [],
    };

    console.log(`🚀 Starting R2 upload for course: ${courseId}`);
    console.log(`   Tile directory: ${tileDir}`);
    console.log(`   Concurrency: ${concurrency}`);

    // Collect all files to upload
    const filesToUpload: Array<{ localPath: string; remoteKey: string }> = [];

    function collectFiles(dir: string, prefix: string = ""): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const remotePrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        const remoteKey = `tiles/${courseId}/${remotePrefix}`;

        if (entry.isDirectory()) {
          collectFiles(fullPath, remotePrefix);
        } else {
          filesToUpload.push({
            localPath: fullPath,
            remoteKey,
          });
        }
      }
    }

    collectFiles(tileDir);

    console.log(`   Found ${filesToUpload.length} files to upload`);

    // Upload with concurrency control
    for (let i = 0; i < filesToUpload.length; i += concurrency) {
      const batch = filesToUpload.slice(i, i + concurrency);
      const uploads = batch.map(({ localPath, remoteKey }) =>
        this.uploadFile(localPath, remoteKey)
      );

      const batchResults = await Promise.all(uploads);

      for (const result of batchResults) {
        if (result.success) {
          results.success++;
          results.totalSize += result.size;
          results.cdnUrls.push(result.url);
          console.log(`   ✓ ${result.key} (${(result.size / 1024).toFixed(2)}KB)`);
        } else {
          results.failed++;
          console.error(`   ✗ ${result.key}: ${result.error}`);
        }
      }
    }

    results.duration = Date.now() - startTime;

    console.log(`\n📊 Upload Summary:`);
    console.log(`   ✓ Successful: ${results.success}`);
    console.log(`   ✗ Failed: ${results.failed}`);
    console.log(`   ⊘ Skipped: ${results.skipped}`);
    console.log(`   📦 Total size: ${(results.totalSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   ⏱️  Duration: ${(results.duration / 1000).toFixed(2)}s`);

    return results;
  }

  /**
   * List files in R2 bucket
   */
  async listFiles(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });

      const response = await this.client.send(command);
      return (response.Contents || []).map((obj) => obj.Key || "");
    } catch (error) {
      console.error("Failed to list files:", error);
      return [];
    }
  }

  /**
   * Delete file from R2
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucketName,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete ${key}:`, error);
      return false;
    }
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".webp": "image/webp",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".json": "application/json",
      ".gz": "application/gzip",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Generate CDN URL for a tile
   */
  generateUrl(courseId: string, z: number, x: number, y: number, format: string = "webp"): string {
    return `${this.baseUrl}/tiles/${courseId}/${z}/${x}/${y}.${format}`;
  }

  /**
   * Cleanup: Close client connection
   */
  async close(): Promise<void> {
    this.client.destroy();
  }
}

// Configuration from environment variables
function getR2Config(): R2Config {
  const config: R2Config = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.CLOUDFLARE_ACCESS_KEY_SECRET || "",
    bucketName: process.env.R2_BUCKET_NAME || "golf-tiles",
    cdnDomain: process.env.CDN_DOMAIN || undefined,
  };

  // Validate required fields
  if (!config.accountId || !config.accessKeyId || !config.accessKeySecret) {
    throw new Error(
      "Missing Cloudflare R2 credentials. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ACCESS_KEY_ID, and CLOUDFLARE_ACCESS_KEY_SECRET"
    );
  }

  return config;
}

// Export for use as module
export { R2Uploader, getR2Config, type R2Config, type UploadResult };

// CLI usage
if (require.main === module) {
  (async () => {
    try {
      const config = getR2Config();
      const uploader = new R2Uploader(config);

      // Example usage
      const tileDir = process.argv[2] || "./tiles/pelham-hills";
      const courseId = "pelham-hills";

      const result = await uploader.uploadTiles(tileDir, courseId);

      // Generate sample URLs
      console.log("\n🌐 Sample CDN URLs:");
      console.log(uploader.generateUrl(courseId, 15, 9500, 12500));
      console.log(uploader.generateUrl(courseId, 18, 76000, 100000));

      await uploader.close();

      process.exit(result.failed > 0 ? 1 : 0);
    } catch (error) {
      console.error("❌ Upload failed:", error);
      process.exit(1);
    }
  })();
}
