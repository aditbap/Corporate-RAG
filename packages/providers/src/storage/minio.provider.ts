import { Client } from 'minio';
import type { Readable } from 'stream';
import type { StorageProvider, StorageObjectInfo } from '@rag/core';

export interface MinioStorageOptions {
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export class MinioStorageProvider implements StorageProvider {
  readonly name = 'minio';
  private readonly client: Client;
  private readonly bucket: string;
  private bucketEnsured = false;

  constructor(options: MinioStorageOptions) {
    this.client = new Client({
      endPoint: options.endPoint,
      port: options.port,
      useSSL: options.useSSL ?? false,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
    this.bucket = options.bucket;
  }

  static fromEnv(): MinioStorageProvider {
    const endPoint = process.env.MINIO_ENDPOINT;
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    const bucket = process.env.MINIO_BUCKET;
    if (!endPoint || !accessKey || !secretKey || !bucket) {
      throw new Error('MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY and MINIO_BUCKET must be set');
    }
    return new MinioStorageProvider({
      endPoint,
      port: process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : undefined,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey,
      secretKey,
      bucket,
    });
  }

  private async ensureBucket() {
    if (this.bucketEnsured) return;
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    this.bucketEnsured = true;
  }

  async upload(key: string, data: NodeJS.ReadableStream, contentType?: string): Promise<StorageObjectInfo> {
    await this.ensureBucket();
    const metaData = contentType ? { 'Content-Type': contentType } : undefined;
    await this.client.putObject(this.bucket, key, data as unknown as Readable, undefined, metaData);
    const stat = await this.client.statObject(this.bucket, key);
    return { key, sizeBytes: stat.size };
  }

  async download(key: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.bucket, key);
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expiresInSeconds);
  }
}
