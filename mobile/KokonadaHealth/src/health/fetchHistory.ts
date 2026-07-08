import { readRecords } from 'react-native-health-connect';
import { HISTORY_DAYS } from './config';

export interface HistoryResult {
  heartRate: any[];
  hrv: any[];
  sleep: any[];
  restingHeartRate: any[];
  window: { startTime: string; endTime: string };
}

function historyWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

// Page through every record of a type in the window. Health Connect returns a
// pageToken when more rows remain; we loop until it's exhausted. Reads older than
// 30 days only succeed if the ReadHealthDataHistory permission was granted.
async function readAll(recordType: string, timeRangeFilter: any): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined;
  do {
    const res: any = await readRecords(recordType as any, {
      timeRangeFilter,
      pageSize: 5000,
      ...(pageToken ? { pageToken } : {}),
    });
    all.push(...(res.records ?? []));
    pageToken = res.pageToken;
  } while (pageToken);
  return all;
}

// Explicit Health Connect queries for the medical-profile metrics.
// HeartRate                  -> records[].samples[] { time, beatsPerMinute }
// HeartRateVariabilityRmssd  -> records[]           { time, heartRateVariabilityMillis }
// SleepSession               -> records[]           { startTime, endTime, stages[] { startTime, endTime, stage } }
// RestingHeartRate           -> records[]           { time, beatsPerMinute }
//   (D-4a: the stateVector classifier needs restingHeartRate; permission was already
//   requested and manifest-declared, but the record was never read.)
export async function fetchSixMonthHistory(): Promise<HistoryResult> {
  const window = historyWindow();
  const timeRangeFilter = { operator: 'between', ...window };

  const [heartRate, hrv, sleep, restingHeartRate] = await Promise.all([
    readAll('HeartRate', timeRangeFilter),
    readAll('HeartRateVariabilityRmssd', timeRangeFilter),
    readAll('SleepSession', timeRangeFilter),
    readAll('RestingHeartRate', timeRangeFilter),
  ]);

  return { heartRate, hrv, sleep, restingHeartRate, window };
}
