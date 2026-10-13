export interface StorageObjectInfo {
  key: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;

  /** Uploads a stream to the given object key, returning the final size. */
  upload(key: string, data: NodeJS.ReadableStream, contentType?: string): Promise<StorageObjectInfo>;

  /** Returns a readable stream for the object. Throws if the key doesn't exist. */
  download(key: string): Promise<NodeJS.ReadableStream>;

  delete(key: string): Promise<void>;

  /** Deletes every object whose key starts with `prefix`; returns how many were removed. */
  deleteByPrefix(prefix: string): Promise<number>;

  /** Throws if the storage backend (or the configured bucket) is unreachable. */
  ping(): Promise<void>;

  /** Pre-signed URL for direct client access, valid for `expiresInSeconds`. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
