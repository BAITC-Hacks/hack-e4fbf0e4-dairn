import {
  isTranslationKey,
  translators,
  type Translate,
  type TranslationKey,
} from '../i18n/messages';
import type {
  AccountCredential,
  ApiErrorBody,
  Attachment,
  Session,
} from './types';

export const API_BASE = (
  import.meta.env.VITE_ASSISTANT_API_URL || 'http://localhost:8000'
).replace(/\/$/, '');
const SESSION_KEY = 'ekt-assistant-session';
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ApiErrorBody,
    public retryAfter = 0,
  ) {
    super(detail.message);
  }
}
export class InterfaceError extends Error {
  constructor(public key: TranslationKey) {
    super(key);
  }
}
export function errorText(
  error: unknown,
  t: Translate = translators.ru,
): string {
  if (error instanceof InterfaceError) return t(error.key);
  if (typeof error === 'string' && isTranslationKey(error)) return t(error);
  if (!(error instanceof ApiError))
    return t(
      'Не удалось связаться с помощником. Проверьте соединение и повторите попытку.',
    );
  const labels: Record<string, string> = {
    stock_changed: t(
      'Остатки изменились. Обновите товары и проверьте новое предложение.',
    ),
    price_changed: t(
      'Цена изменилась. Обновите товары и подтвердите новое предложение.',
    ),
    proposal_changed: t(
      'Предложение изменилось. Сформируйте и проверьте его заново.',
    ),
    unavailable_selection: t(
      'Количество недоступно. Обновите остатки и проверьте шаг и минимум заказа.',
    ),
    unknown_price: t('Цена неизвестна. Добавление пока недоступно.'),
    cart_not_configured: t(
      'Корзина партнёра ещё не подключена. Добавление недоступно.',
    ),
    attachment_limit: t(
      'Достигнут лимит файлов в сессии. Начните новый диалог.',
    ),
    message_limit: t('Достигнут лимит сообщений. Начните новый диалог.'),
    idempotency_conflict: t(
      'Конфликт повторного запроса. Обновите диалог перед новой отправкой.',
    ),
    bootstrap_required: t('Войдите в аккаунт, чтобы начать диалог.'),
  };
  if (labels[error.detail.code]) return labels[error.detail.code];
  if (error.status === 401)
    return t(
      'Сессия истекла. Начните новый диалог. Корзина автоматически не изменяется.',
    );
  if (error.status === 403)
    return t('Доступ к этой сессии запрещён. Начните новый диалог.');
  if (error.status === 404)
    return t('Данные не найдены или недоступны в этой сессии.');
  if (error.status === 410)
    return t('Срок действия данных истёк. Начните этот шаг заново.');
  if (error.status === 429)
    return t('Слишком много запросов. Подождите и повторите попытку.');
  return error.detail.message || t('Не удалось выполнить запрос.');
}
export function readSession(): Session | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(SESSION_KEY) || 'null',
    ) as Session | null;
    if (
      value &&
      typeof value.session_token === 'string' &&
      typeof value.session_id === 'string' &&
      Date.parse(value.expires_at) > Date.now()
    )
      return value;
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* Storage may be unavailable; an in-memory session still works. */
  }
  return null;
}
export function forgetSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* optional storage */
  }
}
export function saveSession(session: Session) {
  if (!session.session_token || session.user_id || session.access_token) return;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        session_id: session.session_id,
        session_token: session.session_token,
        expires_at: session.expires_at,
        locale: session.locale,
        mode: session.mode,
      }),
    );
  } catch {
    /* optional storage */
  }
}
export function sessionPath(session: Session) {
  return `/v1/sessions/${encodeURIComponent(session.session_id)}`;
}
function retryDelay(value: string | null) {
  if (!value) return 2000;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - Date.now()) || 2000;
}
export function bearerToken(auth: Session | AccountCredential): string {
  const expiry = 'auth_expires_at' in auth ? auth.auth_expires_at : null;
  const token =
    auth.access_token || ('session_token' in auth ? auth.session_token : null);
  if (
    !token ||
    Date.parse(auth.expires_at) <= Date.now() ||
    (expiry && Date.parse(expiry) <= Date.now())
  )
    throw new ApiError(401, {
      code: 'session_expired',
      message: 'Session expired',
    });
  return token;
}
export async function request<T>(
  path: string,
  session: Session | AccountCredential | null,
  signal: AbortSignal,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  method?: 'DELETE',
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (session) headers.Authorization = `Bearer ${bearerToken(session)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!response.ok) {
    const raw = (await response
      .json()
      .catch(() => ({}))) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      {
        code: raw.code || 'request_failed',
        message: raw.message || '',
        retryable: raw.retryable,
        request_id: raw.request_id,
      },
      response.status === 429
        ? retryDelay(response.headers.get('Retry-After'))
        : 0,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function uploadFile(
  file: File,
  session: Session,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('POST', `${API_BASE}${sessionPath(session)}/attachments`);
    xhr.setRequestHeader('Authorization', `Bearer ${bearerToken(session)}`);
    xhr.timeout = 60000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.onerror = () => reject(new TypeError('Network error'));
    xhr.ontimeout = () => reject(new TypeError('Upload timeout'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as Attachment & ApiErrorBody;
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else
          reject(
            new ApiError(
              xhr.status,
              data,
              xhr.status === 429
                ? retryDelay(xhr.getResponseHeader('Retry-After'))
                : 0,
            ),
          );
      } catch {
        reject(new TypeError('Invalid upload response'));
      }
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
export function safeLink(
  value: string,
  kind: 'cart' | 'certificate' | 'product',
): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const allowed =
      kind === 'cart'
        ? [window.location.origin]
        : [
            'https://ekt.kz',
            new URL(API_BASE, window.location.origin).origin,
            ...(import.meta.env.VITE_CERTIFICATE_ORIGINS || '')
              .split(',')
              .filter(Boolean),
          ];
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      allowed.includes(url.origin)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
