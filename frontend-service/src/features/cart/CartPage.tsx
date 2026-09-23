import { useEffect, useState } from 'react';
import {
  ApiError,
  errorText,
  forgetSession,
  readSession,
  request,
  sessionPath,
} from '../../api/client';
import type { Cart } from '../../api/types';
import { QuoteRows } from './QuoteRows';
export function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const session = readSession();
    const expected = new URLSearchParams(window.location.search).get(
      'session_id',
    );
    async function load() {
      try {
        if (!session || session.session_id !== expected)
          throw new Error(
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
          setError(
            cause instanceof ApiError
              ? errorText(cause)
              : (cause as Error).message,
          );
        }
      }
    }
    void load();
    return () => abort.abort();
  }, [revision]);
  return (
    <main id="main" className="cart-page">
      <a href="/">← Вернуться к помощнику</a>
      <span className="eyebrow">Электрокомплект / Помощник</span>
      <h1>Ваша демо-корзина</h1>
      <p className="demo-banner">
        Демонстрация. Это не заказ и не корзина сайта ekt.kz. Оплата здесь не
        принимается.
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {cart ? (
        <>
          <p>Версия корзины: {cart.version}</p>
          {cart.items.length ? (
            <QuoteRows items={cart.items} />
          ) : (
            <p>В корзине пока нет товаров.</p>
          )}
        </>
      ) : (
        !error && <p role="status">Загружаем корзину…</p>
      )}
      <button
        className="secondary"
        onClick={() => setRevision((value) => value + 1)}
      >
        Обновить корзину
      </button>
    </main>
  );
}
