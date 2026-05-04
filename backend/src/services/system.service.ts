import os from 'node:os';
import { getR2Stats, type R2Stats } from './r2-stats.service';
import { getConfig } from '../config';

const config = getConfig();

interface SystemStatus {
    localIps: string[];
    online: boolean;
    uptime: number;
    r2?: R2Stats;
}

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

    const status: SystemStatus = {
        localIps,
        online: true,
        uptime: process.uptime(),
    };

    if (config.r2.enabled) {
        try {
            status.r2 = await getR2Stats();
        } catch (error: any) {
            console.error('Failed to include R2 stats in system status:', {
                message: error.message,
                code: error.code,
                name: error.name,
            });
        }
    }

    return status;
};
