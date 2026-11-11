import { createContext, useContext } from 'react';

/**
 * Starts a Garmin sync and opens its progress sheet. The sheet lives in the frame (Shell) so it stays
 * open across screens; the button that starts it lives in the Activities header, as in the app.
 */
export const SyncNow = createContext<{ start: () => void; running: boolean }>({
  start: () => undefined,
  running: false,
});

export const useSyncNow = () => useContext(SyncNow);
