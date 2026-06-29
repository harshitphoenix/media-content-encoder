import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketOriginals: string;
  bucketVariants: string;
  cdnBaseUrl: string;
  cdnUrlTtlSeconds: number;
  /** Set true when using MinIO or other self-hosted S3-compatible stores */
  forcePathStyle: boolean;
  /**
   * When true, deliveryUrl() generates presigned S3 URLs instead of plain CDN URLs.
   * Use for private buckets. HLS/DASH manifests always use cdnUrl() regardless,
   * since presigned URLs break relative segment resolution.
   */
  useSignedUrls?: boolean;
}

export interface UploadOptions {
  contentType: string;
  metadata?: Record<string, string>;
  /**
   * Cache-Control header value for the stored object.
   * Immutable processed variants: 'public, max-age=31536000, immutable'
   * Short-lived manifests:        'public, max-age=30'
   */
  cacheControl?: string;
}

export class StorageClient {
  private readonly s3: S3Client;
  readonly bucketOriginals: string;
  readonly bucketVariants: string;
  private readonly cdnBaseUrl: string;
  private readonly cdnUrlTtlSeconds: number;
  private readonly useSignedUrls: boolean;

  constructor(private readonly config: StorageConfig) {
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
    this.bucketOriginals = config.bucketOriginals;
    this.bucketVariants = config.bucketVariants;
    this.cdnBaseUrl = config.cdnBaseUrl.replace(/\/$/, '');
    this.cdnUrlTtlSeconds = config.cdnUrlTtlSeconds;
    this.useSignedUrls = config.useSignedUrls ?? false;
  }

  /** Upload an object from a Buffer or Readable stream. */
  async upload(
    bucket: string,
    key: string,
    body: Buffer | Readable,
    opts: UploadOptions,
  ): Promise<void> {
    const input: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      Metadata: opts.metadata,
      ...(opts.cacheControl !== undefined ? { CacheControl: opts.cacheControl } : {}),
    };
    await this.s3.send(new PutObjectCommand(input));
  }

  /** Download an object as a Buffer. */
  async download(bucket: string, key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty response body for s3://${bucket}/${key}`);
    // transformToByteArray is available on all SDK v3 response bodies
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** Get object metadata without downloading content. Throws if not found. */
  async stat(bucket: string, key: string): Promise<{ sizeBytes: number; contentType: string }> {
    const res = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  }

  /** Delete a single object. */
  async delete(bucket: string, key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** Delete multiple objects (up to 1000 per call). */
  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const chunks = chunkArray(keys, 1000);
    await Promise.all(
      chunks.map((chunk) =>
        this.s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((k) => ({ Key: k })) },
          }),
        ),
      ),
    );
  }

  /**
   * List all object keys under a given prefix (paginates automatically).
   * Useful for finding HLS/DASH segment files that are not individually tracked in DB.
   */
  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(continuationToken !== undefined ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken !== undefined);

    return keys;
  }

  /**
   * Generate a pre-signed download URL valid for `cdnUrlTtlSeconds`.
   * Use when assets are private. For public CDN assets, use `cdnUrl()` instead.
   */
  async signedUrl(bucket: string, key: string, ttlSeconds?: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.s3, cmd, {
      expiresIn: ttlSeconds ?? this.cdnUrlTtlSeconds,
    });
  }

  /**
   * Construct a CDN URL for a variant object.
   * Only suitable when assets are publicly accessible via the CDN.
   */
  cdnUrl(key: string): string {
    return `${this.cdnBaseUrl}/${key}`;
  }

  /**
   * Generate a delivery URL for a processed asset.
   * Returns a presigned S3 URL when `useSignedUrls` is true, otherwise a plain CDN URL.
   *
   * NOT suitable for HLS/DASH manifests — use cdnUrl() for those, since presigned
   * URLs break relative segment resolution in media players.
   */
  async deliveryUrl(bucket: string, key: string, ttlSeconds?: number): Promise<string> {
    if (this.useSignedUrls) {
      return this.signedUrl(bucket, key, ttlSeconds);
    }
    return this.cdnUrl(key);
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
