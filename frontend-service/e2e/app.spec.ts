import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {
  Attachment,
  Cart,
  Message,
  MessageBody,
  Product,
  Proposal,
  Selection,
} from '../src/api/types';
const expiry = () => new Date(Date.now() + 86400000).toISOString();
const product: Product = {
  id: 'demo-1',
  sku: 'DEMO-C16',
  name: 'Демонстрационный автомат C16',
  price: { amount: '1500', currency: 'KZT' },
  unit: 'шт',
  quantity_step: '1',
  minimum_quantity: '1',
  stock: [{ warehouse_id: 'demo-almaty', available_quantity: '20' }],
  source: 'synthetic',
  attributes: { rated_current: '16 A' },
  certificates: [],
  observed_at: new Date().toISOString(),
};
interface MockOptions {
  retryMessage?: boolean;
  retryConfirmation?: boolean;
  confirmStatus?: number;
  confirmCode?: string;
  failedMessage?: boolean;
  expire?: boolean;
  slowUploads?: boolean;
}
async function mockAssistant(page: Page, options: MockOptions = {}) {
  const received: MessageBody[] = [];
  const confirmations: { body: unknown; key: string | undefined }[] = [];
  const attachments: Attachment[] = [];
  let activeUploads = 0;
  let maxUploads = 0;
  let message: Message | null = null;
  let proposal: Proposal | null = null;
  const cart: Cart = {
    cart_id: 'session-a',
    version: '0',
    items: [],
    mode: 'demo',
    cart_url: 'http://127.0.0.1:4173/cart?session_id=session-a',
  };
  await page.route('**/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/v1/sessions')
      return json(
        {
          session_id: 'session-a',
          session_token: 'test-secret',
          locale: 'ru',
          mode: 'demo',
          expires_at: expiry(),
        },
        201,
      );
    expect(req.headers().authorization).toBe('Bearer test-secret');
    expect(req.url()).not.toContain('test-secret');
    if (path.endsWith('/attachments') && method === 'POST') {
      activeUploads++;
      maxUploads = Math.max(maxUploads, activeUploads);
      const id = String(attachments.length + 1);
      const a: Attachment = {
        attachment_id: id,
        filename: `spec-${id}.pdf`,
        media_type: 'application/pdf',
        status: 'queued',
        expires_at: expiry(),
        warnings: [],
        blocks_count: 0,
      };
      attachments.push(a);
      if (options.slowUploads)
        await new Promise((resolve) => setTimeout(resolve, 250));
      activeUploads--;
      return json(a, 202);
    }
    if (path.includes('/attachments/'))
      return json({
        ...attachments.find((a) => a.attachment_id === path.split('/').at(-1)),
        status: 'ready',
      });
    if (path.endsWith('/messages') && method === 'GET')
      return json(message ? [message] : []);
    if (path.endsWith('/messages') && method === 'POST') {
      const body = req.postDataJSON() as MessageBody;
      received.push(body);
      if (options.expire)
        return json(
          { code: 'session_expired', message: 'Session expired' },
          401,
        );
      if (options.retryMessage && received.length === 1)
        return route.abort('failed');
      message = {
        ...body,
        message_id: 'm1',
        status: 'queued',
        answer: null,
        products: [],
        alternatives: [],
        sources: [],
        warnings: [],
        error: null,
        answer_mode: null,
        created_at: new Date().toISOString(),
        status_url: '/v1/sessions/session-a/messages/m1',
        events_url: '',
      };
      return json(message, 202);
    }
    if (path.endsWith('/messages/m1')) {
      message = {
        ...message!,
        status: options.failedMessage ? 'failed' : 'completed',
        answer: options.failedMessage ? null : 'Нашли товар по вашему запросу.',
        products: options.failedMessage ? [] : [product],
        warnings: ['Демонстрационные данные. Проверьте выбор.'],
        sources: [{ kind: 'catalog', reference: 'DEMO-C16' }],
        error: options.failedMessage
          ? {
              code: 'parse_failed',
              message: 'Файл не содержит читаемого текста',
            }
          : null,
      };
      return json(message);
    }
    if (path.endsWith('/cart/proposals')) {
      const body = req.postDataJSON() as { items: Selection[] };
      proposal = {
        proposal_id: 'proposal-a',
        version: 1,
        confirmation_token: 'one-use-token',
        expires_at: expiry(),
        status: 'pending',
        items: body.items.map((selection) => ({
          selection,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          price: product.price!,
        })),
      };
      return json(proposal, 201);
    }
    if (path.endsWith('/confirm')) {
      confirmations.push({
        body: req.postDataJSON(),
        key: req.headers()['idempotency-key'],
      });
      if (options.retryConfirmation && confirmations.length === 1)
        return route.abort('failed');
      if (options.confirmStatus)
        return json(
          {
            code: options.confirmCode || 'stock_changed',
            message: 'Stock changed',
          },
          options.confirmStatus,
        );
      cart.items = proposal!.items;
      cart.version = '1';
      return json({
        operation_id: 'operation-a',
        proposal_id: proposal!.proposal_id,
        status: 'committed',
        cart,
      });
    }
    if (path.endsWith('/cart')) return json(cart);
    return json({ code: 'not_found', message: 'Not found' }, 404);
  });
  return {
    received,
    confirmations,
    attachments,
    cart,
    getMaxUploads: () => maxUploads,
  };
}
async function sendText(page: Page, text = 'DEMO-C16') {
  await expect(
    page.getByRole('textbox', { name: 'Ваше сообщение' }),
  ).toBeEnabled();
  await page.getByRole('textbox', { name: 'Ваше сообщение' }).fill(text);
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
}
async function selectAndReview(page: Page) {
  await page.getByLabel('Количество, шт').fill('2');
  await page.getByRole('button', { name: 'Выбрать 2 шт' }).click();
  await page.getByRole('button', { name: 'Проверить предложение' }).click();
  await expect(
    page.getByRole('button', { name: 'Добавить в корзину', exact: true }),
  ).toBeVisible();
}
test('widget is accessible, collapsible, and requires explicit cart confirmation', async ({
  page,
}) => {
  const mock = await mockAssistant(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'Ваше сообщение' }),
  ).toBeEnabled();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(
    page.getByLabel('Открыть помощника', { exact: true }),
  ).toBeFocused();
  await page.getByLabel('Открыть помощника', { exact: true }).click();
  await sendText(page);
  await selectAndReview(page);
  expect(mock.confirmations).toHaveLength(0);
  expect(mock.cart.items).toHaveLength(0);
  expect(
    (
      await new AxeBuilder({ page })
        .include('.chat-widget')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Добавить в корзину', exact: true })
    .click();
  await page.getByRole('link', { name: 'Открыть корзину' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ваша демо-корзина' }),
  ).toBeVisible();
  await expect(page.getByText('2 шт × 1500 KZT / шт')).toBeVisible();
  expect(mock.confirmations).toHaveLength(1);
  expect(page.url()).not.toContain('test-secret');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.goto('/cart?session_id=someone-else');
  await expect(page.getByRole('alert')).toContainText(
    'недоступна в текущей вкладке',
  );
});
test('network retries retain message and confirmation identities', async ({
  page,
}) => {
  const mock = await mockAssistant(page, {
    retryMessage: true,
    retryConfirmation: true,
  });
  await page.goto('/');
  await sendText(page);
  await page.getByRole('button', { name: 'Повторить отправку' }).click();
  await selectAndReview(page);
  expect(mock.received).toHaveLength(2);
  expect(mock.received[0]).toEqual(mock.received[1]);
  await page
    .getByRole('button', { name: 'Добавить в корзину', exact: true })
    .click();
  await page.getByRole('button', { name: 'Повторить подтверждение' }).click();
  await expect(
    page.getByRole('link', { name: 'Открыть корзину' }),
  ).toBeVisible();
  expect(mock.confirmations).toHaveLength(2);
  expect(mock.confirmations[0]).toEqual(mock.confirmations[1]);
  expect(mock.cart.items[0].selection.quantity).toBe('2');
});
test('uploads start immediately, use at most two connections, and can be reused', async ({
  page,
}) => {
  const mock = await mockAssistant(page, { slowUploads: true });
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'Ваше сообщение' }),
  ).toBeEnabled();
  await page.getByLabel('Прикрепить файлы').setInputFiles(
    [1, 2, 3].map((n) => ({
      name: `spec-${n}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mock'),
    })),
  );
  await expect(
    page.getByRole('button', { name: 'Отправить сообщение', exact: true }),
  ).toBeEnabled();
  expect(mock.attachments).toHaveLength(3);
  expect(mock.getMaxUploads()).toBe(2);
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  await expect(page.getByText('Нашли товар по вашему запросу.')).toBeVisible();
  expect(mock.received[0].text).toBe('');
  expect(mock.received[0].attachment_ids).toHaveLength(3);
  await page
    .getByText('Файлы: 0 выбрано · 3 в диалоге', { exact: true })
    .click();
  await page.getByRole('checkbox').first().check();
  await sendText(page, 'Уточните характеристики');
  await expect.poll(() => mock.received.length).toBe(2);
  expect(mock.received[1].attachment_ids).toEqual(['1']);
  expect(mock.attachments).toHaveLength(3);
});
test('changed stock invalidates the proposal without another confirmation', async ({
  page,
}) => {
  const mock = await mockAssistant(page, { confirmStatus: 409 });
  await page.goto('/');
  await sendText(page);
  await selectAndReview(page);
  await page
    .getByRole('button', { name: 'Добавить в корзину', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Остатки изменились');
  await expect(
    page.getByRole('button', { name: 'Добавить в корзину', exact: true }),
  ).toHaveCount(0);
  expect(mock.cart.items).toHaveLength(0);
  expect(mock.confirmations).toHaveLength(1);
});
test('expired session clears authorized UI and does not replay the message', async ({
  page,
}) => {
  const mock = await mockAssistant(page, { expire: true });
  await page.goto('/');
  await sendText(page);
  await expect(page.getByRole('alert')).toContainText('Сессия истекла');
  await expect(
    page.getByRole('textbox', { name: 'Ваше сообщение' }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem('ekt-assistant-session')),
  ).toBeNull();
  expect(mock.received).toHaveLength(1);
  expect(mock.confirmations).toHaveLength(0);
});
test('HTTP-success terminal message failure remains visible', async ({
  page,
}) => {
  await mockAssistant(page, { failedMessage: true });
  await page.goto('/');
  await sendText(page);
  await expect(
    page.getByText('Файл не содержит читаемого текста'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Исправить и отправить заново' }),
  ).toBeVisible();
});

test('header cart opens the current session cart without exposing the token', async ({
  page,
}) => {
  await mockAssistant(page);
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'Ваше сообщение' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Свернуть чат', exact: true }).click();
  const cartLink = page.getByRole('link', { name: 'Корзина', exact: true });
  await expect(cartLink).toBeVisible();
  await expect(cartLink).toHaveAttribute('href', '/cart');
  await cartLink.click();
  await expect(
    page.getByRole('heading', { name: 'Ваша демо-корзина' }),
  ).toBeVisible();
  await expect(page.getByText('В корзине пока нет товаров.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Корзина', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  expect(page.url()).not.toContain('test-secret');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

async function switchLanguage(page: Page, language: 'ru' | 'kk') {
  const open = await page.getByRole('dialog').isVisible();
  if (open)
    await page
      .getByRole('button', { name: /^(Свернуть чат|Чатты жию)$/ })
      .click();
  await page
    .getByRole('button', {
      name: language === 'kk' ? 'Қазақша' : 'Русский',
      exact: true,
    })
    .click();
  if (open)
    await page
      .getByLabel(language === 'kk' ? 'Көмекшіні ашу' : 'Открыть помощника', {
        exact: true,
      })
      .click();
}

test('Kazakh UI preserves drafts and API content, completes cart flow, and persists on reload', async ({
  page,
}) => {
  const mock = await mockAssistant(page);
  const sessions: unknown[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/v1/sessions' &&
      request.method() === 'POST'
    )
      sessions.push(request.postDataJSON());
  });
  await page.goto('/');
  await expect(page.locator('#chat-message')).toBeEnabled();
  await page.locator('#chat-message').fill('Мой исходный вопрос DEMO-C16');
  await switchLanguage(page, 'kk');
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(
    page.getByRole('button', { name: 'Қазақша', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'ЭКТ көмекшісі' }),
  ).toBeVisible();
  await expect(page.locator('#chat-message')).toHaveValue(
    'Мой исходный вопрос DEMO-C16',
  );
  await expect(
    page.getByRole('button', { name: 'DEMO-C16 тексеру', exact: true }),
  ).toBeVisible();
  expect(sessions).toEqual([{ locale: 'ru' }]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByLabel('Файлдарды тіркеу').setInputFiles({
    name: 'unsupported.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('test'),
  });
  await expect(page.getByRole('alert')).toContainText(
    'Бос файлдар қабылданбайды.',
  );
  await switchLanguage(page, 'ru');
  await expect(page.getByRole('alert')).toContainText(
    'Пустые файлы не принимаются.',
  );
  await switchLanguage(page, 'kk');
  await page
    .getByRole('button', { name: 'Хабарлама жіберу', exact: true })
    .click();
  await expect(page.getByText('Нашли товар по вашему запросу.')).toBeVisible();
  await expect(
    page.getByText('Демонстрационные данные. Проверьте выбор.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  expect(mock.received[0].text).toBe('Мой исходный вопрос DEMO-C16');
  await page.getByLabel('Саны, шт').fill('2');
  await page.getByRole('button', { name: '2 шт таңдау', exact: true }).click();
  await page.getByRole('button', { name: 'Ұсынысты тексеру' }).click();
  await expect(
    page.getByRole('button', { name: 'Себетке қосу', exact: true }),
  ).toBeVisible();
  await switchLanguage(page, 'ru');
  await expect(
    page.getByRole('button', { name: 'Добавить в корзину', exact: true }),
  ).toBeVisible();
  await switchLanguage(page, 'kk');
  expect(mock.confirmations).toHaveLength(0);
  await page.getByRole('button', { name: 'Себетке қосу', exact: true }).click();
  await page.getByRole('link', { name: 'Себетті ашу' }).click();
  await expect(
    page.getByRole('heading', { name: 'Демо-себетіңіз' }),
  ).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await expect(page.getByText('2 шт × 1500 KZT / шт')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(page.getByText('2 шт × 1500 KZT / шт')).toBeVisible();
  await expect(page).toHaveTitle('Электрокомплект · Чат-көмекші');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(mock.confirmations).toHaveLength(1);
  expect(sessions).toEqual([{ locale: 'ru' }]);
  await page.getByRole('link', { name: '← Көмекшіге оралу' }).click();
  await expect(page.getByText('Нашли товар по вашему запросу.')).toBeVisible();
  await page.getByRole('button', { name: 'Чатты жию', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Дұрыс шешімдер.',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('Kazakh interface leaves API error messages unchanged', async ({
  page,
}) => {
  await mockAssistant(page, { failedMessage: true });
  await page.goto('/');
  await expect(page.locator('#chat-message')).toBeEnabled();
  await switchLanguage(page, 'kk');
  await page.locator('#chat-message').fill('DEMO-C16');
  await page
    .getByRole('button', { name: 'Хабарлама жіберу', exact: true })
    .click();
  await expect(
    page.getByText('Файл не содержит читаемого текста'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Түзетіп, қайта жіберу' }),
  ).toBeVisible();
});

test('language switching works when preference storage is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'ekt-interface-language')
        throw new DOMException('Blocked', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ekt-interface-language')
        throw new DOMException('Blocked', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  await mockAssistant(page);
  await page.goto('/');
  await expect(page.locator('#chat-message')).toBeEnabled();
  await switchLanguage(page, 'kk');
  await expect(
    page.getByRole('heading', { name: 'ЭКТ көмекшісі' }),
  ).toBeVisible();
  await expect(page.locator('#chat-message')).toBeEnabled();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});
