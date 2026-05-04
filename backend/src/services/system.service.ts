import os from 'node:os';

export const getSystemStatus = () => {
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
        uptime: process.uptime(),
    };
};
