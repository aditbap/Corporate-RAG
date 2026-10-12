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

  /** Pre-signed URL for direct client access, valid for `expiresInSeconds`. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
