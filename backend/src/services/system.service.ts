import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import { getConfig } from '../config';

type StorageHealthStatus = 'ok' | 'warning' | 'critical';

interface DiskStatus {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    status: StorageHealthStatus;
}

interface StorageStatus {
    database: {
        path: string;
        mainBytes: number | null;
        shmBytes: number | null;
        totalBytes: number | null;
        walBytes: number | null;
    };
    directories: {
        processedBytes: number | null;
        sessionsBytes: number | null;
        sourceFilesBytes: number | null;
        uploadsRootBytes: number | null;
    };
    disk: DiskStatus | null;
}

interface SystemStatus {
    localIps: string[];
    online: boolean;
    storage: StorageStatus;
    uptime: number;
}

const getStorageHealthStatus = (freeBytes: number, totalBytes: number): StorageHealthStatus => {
    if (totalBytes <= 0) {
        return 'critical';
    }

    const freePercent = (freeBytes / totalBytes) * 100;
    if (freePercent < 10) {
        return 'critical';
    }

    if (freePercent < 20) {
        return 'warning';
    }

    return 'ok';
};

const safeStatSize = async (filePath: string) => {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
};

const getDirectorySize = async (directoryPath: string): Promise<number | null> => {
    try {
        if (!(await fs.pathExists(directoryPath))) {
            return null;
        }

        let totalBytes = 0;
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(directoryPath, entry.name);

            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isDirectory()) {
                const childSize = await getDirectorySize(entryPath);
                totalBytes += childSize ?? 0;
                continue;
            }

            if (entry.isFile()) {
                const size = await safeStatSize(entryPath);
                totalBytes += size ?? 0;
            }
        }

        return totalBytes;
    } catch {
        return null;
    }
};

const getDirectFileSize = async (directoryPath: string): Promise<number | null> => {
    try {
        if (!(await fs.pathExists(directoryPath))) {
            return null;
        }

        let totalBytes = 0;
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }

            const size = await safeStatSize(path.join(directoryPath, entry.name));
            totalBytes += size ?? 0;
        }

        return totalBytes;
    } catch {
        return null;
    }
};

const getDiskStatus = async (targetPath: string): Promise<DiskStatus | null> => {
    try {
        const stats = await statfs(targetPath);
        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bavail * stats.bsize;
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 100;

        return {
            freeBytes,
            path: targetPath,
            status: getStorageHealthStatus(freeBytes, totalBytes),
            totalBytes,
            usedBytes,
            usedPercent,
        };
    } catch {
        return null;
    }
};

const getDatabaseStatus = async (dbFile: string): Promise<StorageStatus['database']> => {
    const [mainBytes, walBytes, shmBytes] = await Promise.all([
        safeStatSize(dbFile),
        safeStatSize(`${dbFile}-wal`),
        safeStatSize(`${dbFile}-shm`),
    ]);

    const availableSizes = [mainBytes, walBytes, shmBytes].filter((value): value is number => value !== null);

    return {
        mainBytes,
        path: dbFile,
        shmBytes: shmBytes ?? 0,
        totalBytes: availableSizes.length ? availableSizes.reduce((total, value) => total + value, 0) : null,
        walBytes: walBytes ?? 0,
    };
};

const getStorageStatus = async (): Promise<StorageStatus> => {
    const config = getConfig();
    const [disk, uploadsRootBytes, sourceFilesBytes, processedBytes, sessionsBytes, database] = await Promise.all([
        getDiskStatus(config.uploadsDir),
        getDirectorySize(config.uploadsDir),
        getDirectFileSize(config.uploadsDir),
        getDirectorySize(config.processedUploadsDir),
        getDirectorySize(config.uploadSessionsDir),
        getDatabaseStatus(config.dbFile),
    ]);

    return {
        database,
        directories: {
            processedBytes,
            sessionsBytes,
            sourceFilesBytes,
            uploadsRootBytes,
        },
        disk,
    };
};

export const getSystemStatus = async (): Promise<SystemStatus> => {
    const nets = os.networkInterfaces();
    const localIps: string[] = [];

    for (const interfaces of Object.values(nets)) {
        for (const network of interfaces || []) {
            if (network.family === 'IPv4' && !network.internal) {
                localIps.push(network.address);
            }
        }
    }

    return {
        localIps,
        online: true,
        storage: await getStorageStatus(),
        uptime: process.uptime(),
    };
};