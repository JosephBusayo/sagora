/** Today's date for a date picker's minimum. The server still checks: this only guides. */
export const today = () => new Date().toISOString().slice(0, 10);
