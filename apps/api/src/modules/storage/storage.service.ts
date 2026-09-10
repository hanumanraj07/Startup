import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '../../config/env';

export interface PresignedUpload {
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface StoredObjectInfo {
  exists: boolean;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * S3-compatible object storage, backed by MinIO locally.
 *
 * The single rule that matters: media never passes through the API. A worker
 * uploads a photo or video directly to storage using a presigned URL; the API
 * only ever sees the resulting key and, afterward, validates what actually
 * landed there. See docs/05-system-architecture.md and
 * docs/20-scalability-performance.md — proof video proxied through the API
 * would saturate it before anything else did.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const env = loadEnv();
    this.bucket = env.STORAGE_BUCKET;
    this.client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
    });
  }

  /**
   * A presigned PUT URL for a proof upload, under a key namespaced to the
   * task and worker so one worker's upload can never collide with or
   * overwrite another's.
   *
   * The content type is a signed header: the client must PUT with exactly
   * this Content-Type or the signature fails, which is the enforcement a
   * presigned PUT can give. Size cannot be constrained by a PUT URL the way a
   * presigned POST policy could; the actual size is checked afterward via
   * `headObject`, in `recordProof`. See docs/16-security-requirements.md.
   */
  async presignTaskProofUpload(params: {
    taskId: string;
    workerId: string;
    contentType: string;
  }): Promise<PresignedUpload> {
    const env = loadEnv();
    const extension = extensionFor(params.contentType);
    const storageKey = `tasks/${params.taskId}/proofs/${params.workerId}/${randomUUID()}${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: env.STORAGE_PRESIGN_TTL_SECONDS,
    });

    return { storageKey, uploadUrl, expiresInSeconds: env.STORAGE_PRESIGN_TTL_SECONDS };
  }

  /**
   * A presigned PUT URL for a KYC document or selfie, under a key namespaced
   * to the user so one applicant's documents can never collide with or
   * overwrite another's. Restricted to image content types only — a
   * government ID scan and a selfie are always photos, never video, and this
   * mirrors `presignTaskProofUpload`'s content-type-as-signed-header pattern.
   */
  async presignKycDocumentUpload(params: {
    userId: string;
    kind: 'front' | 'back' | 'selfie';
    contentType: string;
  }): Promise<PresignedUpload> {
    const env = loadEnv();
    const extension = extensionFor(params.contentType);
    const storageKey = `kyc/${params.userId}/${params.kind}/${randomUUID()}${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: env.STORAGE_PRESIGN_TTL_SECONDS,
    });

    return { storageKey, uploadUrl, expiresInSeconds: env.STORAGE_PRESIGN_TTL_SECONDS };
  }

  /**
   * A short-lived presigned GET, for viewing evidence. There is no permanent
   * public URL for any proof or KYC media anywhere in this codebase — every
   * read goes through this method. See docs/06-database-design.md.
   */
  async presignGet(storageKey: string): Promise<string> {
    const env = loadEnv();
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.client, command, { expiresIn: env.STORAGE_PRESIGN_TTL_SECONDS });
  }

  /**
   * What actually landed at a key, read directly from storage rather than
   * trusted from whatever the client claims it uploaded. This is the
   * post-upload validation docs/16-security-requirements.md requires: "the
   * API validates the stored object after upload: actual content type,
   * actual size."
   */
  async headObject(storageKey: string): Promise<StoredObjectInfo> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      return { exists: true, contentType: result.ContentType, sizeBytes: result.ContentLength };
    } catch {
      return { exists: false };
    }
  }
}

function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
  };
  return map[contentType] ?? '';
}
