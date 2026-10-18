import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../services/api.js';

// Runs an async loader and tracks data / loading / error. `deps` re-run it.
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null, status: null });
  const latest = useRef(0);

  const run = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (id === latest.current) setState({ data, loading: false, error: null, status: 200 });
    } catch (err) {
      if (id === latest.current) {
        setState({ data: null, loading: false, error: apiErrorMessage(err), status: err?.response?.status ?? null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}
