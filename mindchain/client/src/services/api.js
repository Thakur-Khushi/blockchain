import axios from 'axios';

// The JWT lives in sessionStorage: it is cleared when the tab closes and is not
// sent automatically like a cookie (so no CSRF). It is still readable by injected
// scripts, which is why the app renders no untrusted HTML.
const TOKEN_KEY = 'mindchain_token';

export const tokenStore = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 20000,
});

api.interceptors.request.use((cfg) => {
  const token = tokenStore.get();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // An expired or revoked session anywhere logs the user out everywhere in the app.
    if (err.response?.status === 401 && tokenStore.get() && !err.config?.url?.startsWith('/auth/login')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('mindchain:session-expired'));
    }
    return Promise.reject(err);
  },
);

// Extracts a user-facing message from an API error.
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const data = err?.response?.data?.error;
  if (data?.details?.length) return data.details.map((d) => d.message).join('. ');
  if (data?.message) return data.message;
  if (err?.code === 'ECONNABORTED') return 'The server took too long to respond.';
  if (err?.request && !err.response) return 'Cannot reach the MindChain server.';
  return fallback;
}

// Field-level validation errors from the API, keyed by field name.
export function apiFieldErrors(err) {
  const details = err?.response?.data?.error?.details ?? [];
  return Object.fromEntries(details.filter((d) => d.field).map((d) => [d.field.split('.').pop(), d.message]));
}
