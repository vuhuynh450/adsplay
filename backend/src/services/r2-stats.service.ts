import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../config';
import { AppError } from '../errors';

const config = getConfig();

export interface R2Stats {
    enabled: boolean;
    bucket: string;
    totalObjects: number;
    totalSizeBytes: number;
    lastUpdated: string;
    error?: string;
}

interface R2StatsCache {
    data: R2Stats;
    expiresAt: number;
}

let cache: R2StatsCache | null = null;
let cachedClient: S3Client | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const API_TIMEOUT_MS = 10000; // 10 seconds

const getClient = (): S3Client => {
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

const isCacheValid = (): boolean => {
    return cache !== null && Date.now() < cache.expiresAt;
};

const setCache = (data: R2Stats): void => {
    cache = {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
    };
};

const fetchR2StatsFromAPI = async (): Promise<R2Stats> => {
    const client = getClient();
    let totalObjects = 0;
    let totalSizeBytes = 0;
    let continuationToken: string | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('R2 API timeout')), API_TIMEOUT_MS);
    });

    try {
        const fetchPage = async (): Promise<void> => {
            const command = new ListObjectsV2Command({
                Bucket: config.r2.bucket,
                MaxKeys: 1000,
                ContinuationToken: continuationToken,
            });

            const response = await Promise.race([
                client.send(command),
                timeoutPromise,
            ]);

            if (response.Contents) {
                totalObjects += response.Contents.length;
                totalSizeBytes += response.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0);
            }

            if (response.IsTruncated && response.NextContinuationToken) {
                continuationToken = response.NextContinuationToken;
                await fetchPage();
            }
        };

        await fetchPage();

        return {
            enabled: true,
            bucket: config.r2.bucket,
            totalObjects,
            totalSizeBytes,
            lastUpdated: new Date().toISOString(),
        };
    } catch (error: any) {
        console.error('Failed to fetch R2 stats:', error);
        
        if (error.name === 'CredentialsProviderError' || error.message?.includes('credentials')) {
            throw new AppError(500, 'R2_AUTH_FAILED', 'R2 authentication failed.');
        }
        
        if (error.message === 'R2 API timeout') {
            throw new AppError(504, 'R2_TIMEOUT', 'R2 API request timed out.');
        }
        
        throw new AppError(500, 'R2_FETCH_FAILED', 'Failed to fetch R2 stats.');
    }
};

export const getR2Stats = async (): Promise<R2Stats> => {
    if (!config.r2.enabled) {
        return {
            enabled: false,
            bucket: '',
            totalObjects: 0,
            totalSizeBytes: 0,
            lastUpdated: '',
        };
    }

    if (isCacheValid() && cache) {
        return cache.data;
    }

    try {
        const stats = await fetchR2StatsFromAPI();
        setCache(stats);
        return stats;
    } catch (error: any) {
        if (cache) {
            console.warn('R2 API failed, returning cached data:', error.message);
            return cache.data;
        }

        return {
            enabled: true,
            bucket: config.r2.bucket,
            totalObjects: 0,
            totalSizeBytes: 0,
            lastUpdated: '',
            error: error.code || 'R2_FETCH_FAILED',
        };
    }
};

export const __invalidateR2StatsCache = (): void => {
    cache = null;
};
