import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';

const LOGS_DIRECTORY = path.join(__dirname, 'logs');
export const FRONTEND_ANALYSIS_TIMING_LOG_PATH = path.join(
  LOGS_DIRECTORY,
  'frontend-analysis-timing.log'
);

export async function appendFrontendAnalysisTimingLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(LOGS_DIRECTORY, { recursive: true });

  const record = JSON.stringify({
    recordedAt: new Date().toISOString(),
    ...entry,
  });

  await appendFile(FRONTEND_ANALYSIS_TIMING_LOG_PATH, `${record}\n`, 'utf8');
}
