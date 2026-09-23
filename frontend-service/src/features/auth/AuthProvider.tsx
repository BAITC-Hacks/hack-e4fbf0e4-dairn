import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE, ApiError } from '../../api/client';
import type { ApiErrorBody } from '../../api/types';
import type { AuthMessageKey } from '../../i18n/authMessages';

export interface AccountUser {
  user_id: string;
  username: string;
  display_name: string;
  created_at: string;
}
export interface AccountCredential {
  access_token: string;
  expires_at: string;
  user: AccountUser;
}
export interface LoginInput {
  username: string;
  password: string;
}
export interface RegisterInput extends LoginInput {
  display_name: string;
}
export interface AuthError {
  key: AuthMessageKey;
  detail?: string;
}
interface AuthState {
  credential: AccountCredential | null;
  user: AccountUser | null;
  busy: boolean;
  error: AuthError | null;
  blockedUntil: number;
  login: (input: LoginInput) => Promise<boolean>;
  register: (input: RegisterInput) => Promise<boolean>;
  logout: () => Promise<boolean>;
  invalidate: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function validateAuthInput(
  input: LoginInput | RegisterInput,
): AuthMessageKey | null {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,64}$/.test(username))
    return 'Введите имя пользователя: 3–64 латинские буквы, цифры, _, . или -.';
  const passwordLength = Array.from(input.password).length;
  if (passwordLength < 12 || passwordLength > 128)
    return 'Пароль должен содержать от 12 до 128 символов.';
  if (
    'display_name' in input &&
    (!input.display_name.trim() || Array.from(input.display_name).length > 100)
  )
    return 'Введите отображаемое имя: от 1 до 100 символов, не только пробелы.';
  return null;
}

async function authRequest<T>(
  path: string,
  signal: AbortSignal,
  method: 'GET' | 'POST',
  token?: string,
  body?: LoginInput | RegisterInput,
): Promise<T> {
  const response = await fetch(`${API_BASE}/v1/auth/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!response.ok) {
    const detail = (await response
      .json()
      .catch(() => ({}))) as Partial<ApiErrorBody>;
    const retry = response.headers.get('Retry-After');
    const delay = retry
      ? Number.isFinite(Number(retry))
        ? Math.max(0, Number(retry) * 1000)
        : Math.max(0, Date.parse(retry) - Date.now()) || 2000
      : 2000;
    throw new ApiError(
      response.status,
      { code: detail.code || 'request_failed', message: detail.message || '' },
      response.status === 429 ? delay : 0,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function authError(error: unknown, fallback: AuthMessageKey): AuthError {
  if (!(error instanceof ApiError))
    return {
      key: 'Не удалось связаться с сервисом. Проверьте соединение и повторите попытку.',
    };
  const key: AuthMessageKey =
    error.status === 429
      ? 'Слишком много попыток входа. Подождите перед повтором.'
      : error.detail.code === 'invalid_credentials'
        ? 'Неверное имя пользователя или пароль.'
        : error.detail.code === 'username_taken'
          ? 'Это имя пользователя уже занято. Выберите другое.'
          : fallback;
  return { key, detail: error.detail.message || undefined };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Account credentials deliberately never enter browser storage.
  const [credential, setCredential] = useState<AccountCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  // Stable identity keeps session request lifecycles from restarting on renders.
  const invalidate = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setCredential(null);
    setBusy(false);
    setError({ key: 'Срок действия входа истёк. Войдите в аккаунт снова.' });
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  const token = credential?.access_token;
  const expiresAt = credential?.expires_at;
  useEffect(() => {
    if (!token || !expiresAt) return;
    const expires = Date.parse(expiresAt);
    const delay = () =>
      Number.isFinite(expires)
        ? Math.max(0, Math.min(expires - Date.now(), 2147483647))
        : 0;
    let expiry = window.setTimeout(checkExpiry, delay());
    function checkExpiry() {
      if (expires > Date.now())
        expiry = window.setTimeout(checkExpiry, delay());
      else invalidate();
    }
    return () => {
      window.clearTimeout(expiry);
    };
  }, [token, expiresAt, invalidate]);

  async function authenticate(
    path: 'login' | 'register',
    input: LoginInput | RegisterInput,
  ) {
    if (inFlight.current || Date.now() < blockedUntil) return false;
    const validation = validateAuthInput(input);
    if (validation) {
      setError({ key: validation });
      return false;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await authRequest<AccountCredential>(
        path,
        controller.signal,
        'POST',
        undefined,
        {
          ...input,
          username: input.username.trim().toLowerCase(),
        },
      );
      // Resolve the profile before publishing the credential, so the chat only
      // establishes its account session once. The auth response is a fallback
      // if a transient profile request fails after successful authentication.
      let user = result.user;
      try {
        user = await authRequest<AccountUser>(
          'me',
          controller.signal,
          'GET',
          result.access_token,
        );
      } catch (cause: unknown) {
        if (cause instanceof ApiError && cause.status === 401) throw cause;
        if (!controller.signal.aborted)
          setError(
            authError(
              cause,
              'Не удалось обновить профиль. Данные аккаунта получены при входе.',
            ),
          );
      }
      if (controller.signal.aborted) return false;
      setCredential({ ...result, user });
      setBlockedUntil(0);
      return true;
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        const fallback =
          cause instanceof ApiError &&
          cause.status === 401 &&
          cause.detail.code !== 'invalid_credentials'
            ? 'Срок действия входа истёк. Войдите в аккаунт снова.'
            : path === 'login'
              ? 'Не удалось выполнить вход. Повторите попытку.'
              : 'Не удалось создать аккаунт. Проверьте данные и повторите попытку.';
        setError(authError(cause, fallback));
        if (cause instanceof ApiError && cause.status === 401)
          setCredential(null);
        if (cause instanceof ApiError && cause.status === 429)
          setBlockedUntil(Date.now() + Math.max(cause.retryAfter, 1000));
      }
      return false;
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  async function logout() {
    if (!credential || inFlight.current) return false;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      await authRequest<void>(
        'logout',
        controller.signal,
        'POST',
        credential.access_token,
      );
      if (controller.signal.aborted) return false;
      setCredential(null);
      return true;
    } catch (cause: unknown) {
      if (controller.signal.aborted) return false;
      if (cause instanceof ApiError && cause.status === 401) {
        invalidate();
        return true;
      }
      setError(
        authError(
          cause,
          'Не удалось завершить выход на сервере. Повторите попытку.',
        ),
      );
      return false;
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <AuthContext.Provider
      value={{
        credential,
        user: credential?.user || null,
        busy,
        error,
        blockedUntil,
        login: (input) => authenticate('login', input),
        register: (input) => authenticate('register', input),
        logout,
        invalidate,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider');
  return context;
}
