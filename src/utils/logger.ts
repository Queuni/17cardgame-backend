/**
 * Simple logger for production deployment
 * Format: [ACTION] [STATUS] [DETAILS]
 */

type LogLevel = "INFO" | "ERROR" | "WARN";

function formatLog(level: LogLevel, action: string, details?: string): string {
    const timestamp = new Date().toISOString();
    const detailStr = details ? ` | ${details}` : "";
    return `[${timestamp}] [${level}] [${action}]${detailStr}`;
}

export const logger = {
    info: (action: string, details?: string) => {
        console.log(formatLog("INFO", action, details));
    },
    error: (action: string, details?: string) => {
        console.error(formatLog("ERROR", action, details));
    },
    warn: (action: string, details?: string) => {
        console.warn(formatLog("WARN", action, details));
    },
};

