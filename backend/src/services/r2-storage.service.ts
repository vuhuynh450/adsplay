import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config';
import { AppError } from '../errors';

const config = getConfig();

interface UploadObjectInput {
    body: Buffer;
    contentType: string;
    objectKey: string;
}

interface UploadObjectResult {
    key: string;
}

interface StreamUrlInput {
    key: string;
}

interface DeleteObjectInput {
    key: string;
}

interface R2StorageTestOverrides {
    deleteObject?: (input: DeleteObjectInput) => Promise<void>;
    getStreamUrl?: (input: StreamUrlInput) => string;
    uploadObject?: (input: UploadObjectInput) => Promise<UploadObjectResult>;
}

let testOverrides: R2StorageTestOverrides | null = null;
let cachedClient: S3Client | null = null;

const getClient = () => {
    if (cachedClient) {
        return cachedClient;
    }

    cachedClient = new S3Client({
        credentials: {
            accessKeyId: config.r2.accessKeyId,
            secretAccessKey: config.r2.secretAccessKey,
        },
        endpoint: config.r2.endpoint,
        region: 'auto',
    });

    return cachedClient;
};

const requireR2Enabled = () => {
    if (!config.r2.enabled) {
        throw new AppError(503, 'R2_STORAGE_DISABLED', 'Cloudflare R2 storage is not enabled.');
    }
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const uploadObject = async (input: UploadObjectInput): Promise<UploadObjectResult> => {
    if (testOverrides?.uploadObject) {
        return testOverrides.uploadObject(input);
    }

    requireR2Enabled();

    const client = getClient();
    await client.send(
        new PutObjectCommand({
            Body: input.body,
            Bucket: config.r2.bucket,
            ContentType: input.contentType,
            Key: input.objectKey,
        }),
    );

    return { key: input.objectKey };
};

export const getStreamUrl = async (input: StreamUrlInput) => {
    if (testOverrides?.getStreamUrl) {
        return testOverrides.getStreamUrl(input);
    }

    requireR2Enabled();

    if (config.r2.publicBaseUrl) {
        const baseUrl = trimTrailingSlash(config.r2.publicBaseUrl);
        return `${baseUrl}/${input.key}`;
    }

    const client = getClient();
    return getSignedUrl(
        client,
        new GetObjectCommand({
            Bucket: config.r2.bucket,
            Key: input.key,
        }),
        { expiresIn: config.r2.signedUrlExpiresSeconds },
    );
};

export const removeObject = async (input: DeleteObjectInput) => {
    if (testOverrides?.deleteObject) {
        await testOverrides.deleteObject(input);
        return;
    }

    requireR2Enabled();

    const client = getClient();
    await client.send(
        new DeleteObjectCommand({
            Bucket: config.r2.bucket,
            Key: input.key,
        }),
    );
};

export const __setR2StorageForTests = (overrides: R2StorageTestOverrides) => {
    testOverrides = overrides;
};

export const __resetR2StorageForTests = () => {
    testOverrides = null;
};
