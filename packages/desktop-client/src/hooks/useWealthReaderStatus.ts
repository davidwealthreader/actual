import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function useWealthReaderStatus(enabled = true) {
  const [configuredWealthReader, setConfiguredWealthReader] = useState<
    boolean | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const status = useSyncServerStatus();

  useEffect(() => {
    if (!enabled) return;

    async function fetch() {
      setIsLoading(true);
      try {
        const results = await send('wealthreader-status');
        setConfiguredWealthReader(results.configured || false);
      } catch {
        setConfiguredWealthReader(false);
      } finally {
        setIsLoading(false);
      }
    }

    if (status === 'online') {
      void fetch();
    }
  }, [status, enabled]);

  return {
    configuredWealthReader,
    isLoading,
  };
}
