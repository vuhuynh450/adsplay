import os from 'node:os';
import { getR2Stats } from './r2-stats.service';
import { getConfig } from '../config';

const config = getConfig();

export const getSystemStatus = async () => {
    const nets = os.networkInterfaces();
    const localIps: string[] = [];

    for (const interfaces of Object.values(nets)) {
        for (const network of interfaces || []) {
            if (network.family === 'IPv4' && !network.internal) {
                localIps.push(network.address);
            }
        }
    }

    const status: any = {
        localIps,
        online: true,
        uptime: process.uptime(),
    };

    if (config.r2.enabled) {
        try {
            status.r2 = await getR2Stats();
        } catch (error) {
            console.error('Failed to include R2 stats in system status:', error);
        }
    }

    return status;
};
