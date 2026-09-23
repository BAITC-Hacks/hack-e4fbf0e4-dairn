import { useLocale } from '../../i18n/LocaleProvider';
import { useEffect, useState } from 'react';
import {
  ApiError,
  InterfaceError,
  errorText,
  forgetSession,
  readSession,
  request,
  sessionPath,
} from '../../api/client';
import type { Cart } from '../../api/types';
import { QuoteRows } from './QuoteRows';
export function CartPage() {
  const { t } = useLocale();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const session = readSession();
    const expected = new URLSearchParams(window.location.search).get(
      'session_id',
    );
    async function load() {
      try {
        if (!session || (expected !== null && session.session_id !== expected))
          throw new InterfaceError(
            'Эта корзина недоступна в текущей вкладке. Вернитесь в чат и откройте ссылку из своей сессии.',
          );
        const result = await request<Cart>(
          `${sessionPath(session)}/cart`,
          session,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setCart(result);
          setError('');
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
            forgetSession();
            setCart(null);
          }
          setError(cause);
        }
      }
    }
    void load();
    return () => abort.abort();
  }, [revision]);
  return (
    <main id="main" className="cart-page">
      <a href="/">{t('← Вернуться к помощнику')}</a>
      <span className="eyebrow">{t('Электрокомплект / Помощник')}</span>
      <h1>{t('Ваша демо-корзина')}</h1>
      <p className="demo-banner">
        {t(
          'Демонстрация. Это не заказ и не корзина сайта ekt.kz. Оплата здесь не принимается.',
        )}
      </p>
      {!!error && (
        <p role="alert" className="error-box">
          {errorText(error, t)}
        </p>
      )}
      {cart ? (
        <>
          <p>
            {t('Версия корзины:')} {cart.version}
          </p>
          {cart.items.length ? (
            <QuoteRows items={cart.items} />
          ) : (
            <p>{t('В корзине пока нет товаров.')}</p>
          )}
        </>
      ) : (
        !error && <p role="status">{t('Загружаем корзину…')}</p>
      )}
      <button
        className="secondary"
        onClick={() => setRevision((value) => value + 1)}
      >
        {t('Обновить корзину')}
      </button>
    </main>
  );
}
