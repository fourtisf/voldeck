function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) =>
    console.log(`${stamp()} [worker] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    console.warn(`${stamp()} [worker] WARN ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`),
  error: (msg: string, err?: unknown) =>
    console.error(`${stamp()} [worker] ERROR ${msg}`, err ?? ''),
};
