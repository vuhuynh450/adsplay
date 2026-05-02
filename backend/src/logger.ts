export const logInfo = (event: string, context: Record<string, unknown> = {}) => {
    console.log(
        JSON.stringify({
            event,
            level: 'info',
            time: new Date().toISOString(),
            ...context,
        }),
    );
};

export const logError = (event: string, context: Record<string, unknown> = {}) => {
    console.error(
        JSON.stringify({
            event,
            level: 'error',
            time: new Date().toISOString(),
            ...context,
        }),
    );
};
