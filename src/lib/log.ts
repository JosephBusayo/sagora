/** One place for failures worth reading later. Vercel keeps what goes to the console. */
export function logError(where: string, err: unknown) {
  console.error(`[${where}]`, err instanceof Error ? err.message : err);
}
