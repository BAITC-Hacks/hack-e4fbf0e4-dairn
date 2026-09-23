import { expect, test, type Page } from '@playwright/test';
import type {
  CatalogMetadata,
  Message,
  MessageBody,
  Product,
} from '../src/api/types';

const accountToken = 'usr_mock-account-secret';
const guestToken = 'mock-guest-secret';
const expiry = () => new Date(Date.now() + 86400000).toISOString();
const user = {
  user_id: 'user-a',
  username: 'alice',
  display_name: 'Alice Test',
  created_at: '2026-09-23T10:00:00Z',
};
const conversation = (id: string) => ({
  session_id: id,
  user_id: user.user_id,
  created_at: '2026-09-23T10:00:00Z',
  expires_at: expiry(),
  locale: 'ru',
  mode: 'authenticated',
});
function message(id: string, sessionId = 'account-000'): Message {
  return {
    message_id: id,
    client_message_id: `client-${id}`,
    text: `Вопрос ${id}`,
    attachment_ids: [],
    status: 'completed',
    answer: `Ответ API ${id}`,
    products: [],
    alternatives: [],
    sources: [],
    warnings: [],
    error: null,
    answer_mode: 'model',
    created_at: '2026-09-23T10:00:00Z',
    status_url: `/v1/sessions/${sessionId}/messages/${id}`,
    events_url: '',
  };
}
interface MockOptions {
  pagination?: boolean;
  expireMessage?: boolean;
  guestForbidden?: boolean;
  emptyHistory?: boolean;
  expiredHistoryFiles?: boolean;
  catalogProducts?: Product[];
}
async function mockIntegration(page: Page, options: MockOptions = {}) {
  const records: {
    method: string;
    path: string;
    search: string;
    body: unknown;
    auth?: string;
  }[] = [];
  let sessions = options.emptyHistory
    ? []
    : Array.from({ length: options.pagination ? 51 : 1 }, (_, i) =>
        conversation(`account-${String(i).padStart(3, '0')}`),
      );
  if (options.expiredHistoryFiles)
    sessions = sessions.map((session) => ({
      ...session,
      created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      expires_at: new Date(Date.now() + 28 * 86400000).toISOString(),
    }));
  const submitted = new Map<string, Message[]>();
  let created = 0;
  await page.route('**/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    const auth = req.headers().authorization;
    const body = req.headers()['content-type']?.includes('application/json')
      ? req.postDataJSON()
      : null;
    records.push({ method, path, search: url.search, body, auth });
    expect(req.url()).not.toContain(accountToken);
    expect(req.url()).not.toContain(guestToken);
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (path === '/v1/auth/login' || path === '/v1/auth/register') {
      expect(auth).toBeUndefined();
      return json(
        {
          access_token: accountToken,
          token_type: 'bearer',
          expires_at: expiry(),
          user,
        },
        path.endsWith('/register') ? 201 : 200,
      );
    }
    if (path.startsWith('/v1/auth/')) {
      expect(auth).toBe(`Bearer ${accountToken}`);
      if (path.endsWith('/me')) return json(user);
      if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
    }
    if (path === '/v1/sessions') {
      if (method === 'GET') {
        expect(auth).toBe(`Bearer ${accountToken}`);
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 50);
        return json(sessions.slice(offset, offset + limit));
      }
      if (!auth) {
        if (options.guestForbidden)
          return json(
            {
              code: 'bootstrap_required',
              message: 'Account credential required',
            },
            401,
          );
        return json(
          {
            session_id: 'guest-a',
            session_token: guestToken,
            expires_at: expiry(),
            locale: 'ru',
            mode: 'demo',
          },
          201,
        );
      }
      expect(auth).toBe(`Bearer ${accountToken}`);
      expect(body).toEqual({ locale: 'ru' });
      const session = conversation(`account-new-${++created}`);
      sessions = [session, ...sessions];
      return json({ ...session, session_token: null }, 201);
    }
    const sessionId = path.split('/')[3];
    expect(auth).toBe(
      `Bearer ${sessionId === 'guest-a' ? guestToken : accountToken}`,
    );
    if (method === 'DELETE' && path === `/v1/sessions/${sessionId}`) {
      sessions = sessions.filter((session) => session.session_id !== sessionId);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/attachments') && method === 'POST') {
      return json(
        {
          attachment_id: 'file-a',
          filename: 'spec.pdf',
          media_type: 'application/pdf',
          status: 'ready',
          expires_at: expiry(),
          warnings: [],
          blocks_count: 1,
        },
        202,
      );
    }
    if (path.endsWith('/attachments/file-a')) {
      return json({
        attachment_id: 'file-a',
        filename: 'spec.pdf',
        media_type: 'application/pdf',
        status: 'ready',
        expires_at: expiry(),
        warnings: [],
        blocks_count: 1,
      });
    }
    if (options.expiredHistoryFiles && path.includes('/attachments/expired-'))
      return json(
        { code: 'attachment_expired', message: 'Attachment expired' },
        410,
      );
    if (path.endsWith('/messages') && method === 'GET') {
      if (options.expiredHistoryFiles && sessionId === 'account-000')
        return json(
          Array.from({ length: 2 }, (_, turn) => ({
            ...message(`expired-files-${turn}`, sessionId),
            attachment_ids: Array.from(
              { length: 10 },
              (_, file) => `expired-${turn * 10 + file}`,
            ),
          })),
        );
      if (options.pagination && sessionId === 'account-000') {
        const offset = Number(url.searchParams.get('offset') || 0);
        return json(
          offset === 0
            ? Array.from({ length: 50 }, (_, i) => message(`history-${i + 1}`))
            : [message('history-0'), message('history-1')],
        );
      }
      return json(submitted.get(sessionId) || []);
    }
    if (path.endsWith('/messages') && method === 'POST') {
      if (options.expireMessage && sessionId !== 'guest-a')
        return json(
          { code: 'unauthorized', message: 'Account token expired' },
          401,
        );
      const request = body as MessageBody;
      const result = {
        ...message(`sent-${records.length}`, sessionId),
        ...request,
      };
      if (options.catalogProducts) {
        result.products = options.catalogProducts;
        result.answer = 'Ответ API: найдены товары из неполного снимка.';
        result.warnings = [
          'API warning: partial catalog coverage; stock freshness unknown.',
        ];
        result.sources = [
          {
            kind: 'catalog',
            reference: 'catalog snapshot',
            metadata: options.catalogProducts[0].catalog_metadata,
          },
        ];
      }
      submitted.set(sessionId, [...(submitted.get(sessionId) || []), result]);
      return json(result);
    }
    if (path.endsWith('/cart'))
      return json({
        cart_id: sessionId,
        version: '0',
        items: [],
        mode: 'demo',
        cart_url: `http://127.0.0.1:4173/cart?session_id=${sessionId}`,
      });
    return json({ code: 'not_found', message: 'Unknown test route' }, 404);
  });
  return { records };
}

async function login(page: Page) {
  await page
    .getByRole('button', { name: 'Войти в аккаунт', exact: true })
    .click();
  await page.getByLabel('Имя пользователя', { exact: true }).fill('alice');
  await page.getByLabel('Пароль', { exact: true }).fill('correct-password-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Выйти', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#chat-message')).toBeEnabled();
}
async function expectNoAccountInStorage(page: Page) {
  const values = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(values)).not.toContain(accountToken);
  expect(page.url()).not.toContain(accountToken);
}

test('account bearer supports uploads, messages and internal cart navigation without persisted credentials', async ({
  page,
}) => {
  const mock = await mockIntegration(page);
  await page.goto('/');
  await login(page);
  await expect
    .poll(() => mock.records.some((r) => r.path === '/v1/auth/me'))
    .toBe(true);
  await expectNoAccountInStorage(page);
  await page.getByLabel('Прикрепить файлы').setInputFiles({
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 mock'),
  });
  await page.locator('#chat-message').fill('Проверьте приложенный файл');
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  await expect(page.locator('.answer-text')).toContainText('Ответ API sent-');
  const sent = mock.records.find(
    (r) => r.method === 'POST' && r.path.endsWith('/messages'),
  );
  expect(sent?.path).toBe('/v1/sessions/account-000/messages');
  expect((sent?.body as MessageBody).attachment_ids).toEqual(['file-a']);
  await page.getByRole('button', { name: 'Свернуть чат', exact: true }).click();
  await page.getByRole('link', { name: 'Корзина', exact: true }).click();
  await expect(
    page.getByText('В корзине пока нет товаров.', { exact: true }),
  ).toBeVisible();
  expect(
    mock.records.find((r) => r.path === '/v1/sessions/account-000/cart')?.auth,
  ).toBe(`Bearer ${accountToken}`);
  await page.getByRole('link', { name: '← Вернуться к помощнику' }).click();
  await page.getByLabel('Открыть помощника', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Выйти', exact: true }),
  ).toBeVisible();
  await expectNoAccountInStorage(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Войти в аккаунт', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Выйти', exact: true }),
  ).toHaveCount(0);
  await expectNoAccountInStorage(page);
});

test('registration works with guests disabled, creates null-token conversations and revokes logout', async ({
  page,
}) => {
  const mock = await mockIntegration(page, {
    guestForbidden: true,
    emptyHistory: true,
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Войти в аккаунт', exact: true })
    .click();
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await page.getByLabel('Имя пользователя', { exact: true }).fill(' Alice ');
  await page.getByLabel('Пароль', { exact: true }).fill('too-short');
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Alice Test');
  await page
    .getByRole('button', { name: 'Создать аккаунт', exact: true })
    .click();
  await expect(
    page.getByText('Пароль должен содержать от 12 до 128 символов.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    mock.records.filter((r) => r.path === '/v1/auth/register'),
  ).toHaveLength(0);
  await page
    .getByLabel('Пароль', { exact: true })
    .fill(' correct-password-123 ');
  await page
    .getByRole('button', { name: 'Создать аккаунт', exact: true })
    .click();
  await expect(page.locator('#chat-message')).toBeEnabled();
  expect(
    mock.records.find((r) => r.path === '/v1/auth/register')?.body,
  ).toEqual({
    username: 'alice',
    password: ' correct-password-123 ',
    display_name: 'Alice Test',
  });
  await page.locator('#chat-message').fill('Мой личный запрос');
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  await expect(page.locator('.answer-text')).toBeVisible();
  expect(
    mock.records.find(
      (r) => r.method === 'POST' && r.path.endsWith('/messages'),
    )?.path,
  ).toBe('/v1/sessions/account-new-1/messages');
  await page.getByRole('button', { name: 'Новый диалог', exact: true }).click();
  await expect
    .poll(
      () =>
        mock.records.filter(
          (r) =>
            r.path === '/v1/sessions' &&
            r.method === 'POST' &&
            r.auth === `Bearer ${accountToken}`,
        ).length,
    )
    .toBe(2);
  await expect(page.locator('.answer-text')).toHaveCount(0);
  await expectNoAccountInStorage(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Войти в аккаунт', exact: true }),
  ).toBeVisible();
  expect(
    mock.records.filter(
      (r) => r.path === '/v1/auth/logout' && r.method === 'POST',
    ),
  ).toHaveLength(1);
  await expect(
    page.getByText('Мой личный запрос', { exact: true }),
  ).toHaveCount(0);
  await expectNoAccountInStorage(page);
});

test('history paginates, deduplicates older messages and requires confirmation before deletion', async ({
  page,
}) => {
  const mock = await mockIntegration(page, { pagination: true });
  await page.goto('/');
  await login(page);
  await expect(page.locator('.exchange')).toHaveCount(50);
  await page
    .getByRole('button', {
      name: 'Загрузить предыдущие сообщения',
      exact: true,
    })
    .click();
  await expect(page.locator('.exchange')).toHaveCount(51);
  await expect(page.locator('.exchange').first()).toContainText(
    'Вопрос history-0',
  );
  await expect(
    page.locator('.user-message').filter({ hasText: /Вопрос history-1$/ }),
  ).toHaveCount(1);
  expect(
    mock.records.some(
      (r) =>
        r.path === '/v1/sessions/account-000/messages' &&
        new URLSearchParams(r.search).get('offset') === '50',
    ),
  ).toBe(true);
  await page.getByText('Мои диалоги', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Загрузить ещё диалоги', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Открыть диалог account-050', exact: true })
    .click();
  await expect(page.locator('.exchange')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Удалить диалог account-050', exact: true })
    .click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(mock.records.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Удалить диалог account-050', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Удалить навсегда', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Открыть диалог account-050',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    mock.records.filter((r) => r.method === 'DELETE').map((r) => r.path),
  ).toEqual(['/v1/sessions/account-050']);
  await expect(
    page.getByRole('button', { name: 'Выйти', exact: true }),
  ).toBeVisible();
});

test('expired account credentials clear signed-in UI without replaying a message', async ({
  page,
}) => {
  const mock = await mockIntegration(page, { expireMessage: true });
  await page.goto('/');
  await login(page);
  await page.locator('#chat-message').fill('Запрос с истёкшим токеном');
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Войти в аккаунт', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Выйти', exact: true }),
  ).toHaveCount(0);
  expect(
    mock.records.filter(
      (r) => r.method === 'POST' && r.path.endsWith('/messages'),
    ),
  ).toHaveLength(1);
  await expectNoAccountInStorage(page);
});

test('expired attachments in 30-day account history do not prevent a fresh upload', async ({
  page,
}) => {
  const mock = await mockIntegration(page, { expiredHistoryFiles: true });
  await page.goto('/');
  await login(page);
  await expect(
    page.getByText(
      'Часть файлов из истории больше недоступна. При необходимости прикрепите их заново.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    mock.records.filter(
      (r) => r.method === 'GET' && r.path.includes('/attachments/expired-'),
    ),
  ).toHaveLength(20);
  await expect(page.locator('.exchange')).toHaveCount(2);
  await page.getByLabel('Прикрепить файлы').setInputFiles({
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 mock'),
  });
  await expect
    .poll(
      () =>
        mock.records.filter(
          (r) => r.method === 'POST' && r.path.endsWith('/attachments'),
        ).length,
    )
    .toBe(1);
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  await expect(page.locator('.exchange')).toHaveCount(3);
  const sent = mock.records.find(
    (r) => r.method === 'POST' && r.path.endsWith('/messages'),
  );
  expect((sent?.body as MessageBody).attachment_ids).toEqual(['file-a']);
  await expect(
    page.getByText('Лимит: 10 файлов в сообщении и 20 в сессии.', {
      exact: true,
    }),
  ).toHaveCount(0);
});

const metadata: CatalogMetadata = {
  source: 'SYNTHETIC_TEST_FIXTURE',
  mode: 'mock',
  coverage: 'PARTIAL',
  pages: [1],
  loadedProducts: 12,
  totalProducts: null,
  observedAt: null,
  loadedAt: '2026-09-23T10:00:00Z',
  expiresAt: null,
  freshness: 'UNKNOWN',
  detailLevel: 'LIST_SUMMARY',
  fallbackReason: 'catalog_connection_unavailable',
};
const httpProduct: Product = {
  id: '45357',
  sku: 'CABLE-001',
  name: 'Название из Catalog API',
  price: null,
  unit: null,
  quantity_step: null,
  minimum_quantity: null,
  stock: [],
  attributes: {},
  certificates: [],
  availability: { status: 'unknown', quantity: null },
  images: [],
  pageUrl: null,
  observed_at: null,
  source: 'synthetic',
  stale: true,
  catalog_metadata: metadata,
};

test('HTTP catalog preserves unknown values, source metadata and API text without cart selection', async ({
  page,
}) => {
  const mock = await mockIntegration(page, {
    catalogProducts: [
      httpProduct,
      {
        ...httpProduct,
        id: '45358',
        sku: 'CABLE-002',
        name: 'Цена без валюты',
        price: { amount: '1234.50', currency: null },
      },
    ],
  });
  await page.goto('/');
  await expect(page.locator('#chat-message')).toBeEnabled();
  await page.locator('#chat-message').fill('кабель');
  await page
    .getByRole('button', { name: 'Отправить сообщение', exact: true })
    .click();
  const cards = page.locator('.product-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Название из Catalog API');
  await expect(cards.first()).toContainText('Цена неизвестна');
  await expect(cards.first()).toContainText('Единица измерения неизвестна');
  await expect(cards.first()).toContainText(
    'Демо-товар · синтетические данные',
  );
  await expect(cards.first()).toContainText(
    'Каталог загружен частично. Показаны только доступные данные.',
  );
  await expect(cards.first()).not.toContainText('KZT');
  await expect(cards.nth(1)).toContainText('1234.50');
  await expect(cards.nth(1)).toContainText('1234.50 KZT');
  await expect(cards.nth(1)).not.toContainText('Валюта неизвестна');
  await cards
    .first()
    .getByText('Характеристики и наличие', { exact: true })
    .click();
  await expect(
    cards.first().getByText('SYNTHETIC_TEST_FIXTURE', { exact: true }),
  ).toBeVisible();
  await expect(
    cards.first().getByText('catalog_connection_unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    cards.first().getByText('Остаток неизвестен', { exact: false }),
  ).toBeVisible();
  await expect(
    cards
      .first()
      .locator('.catalog-metadata > div')
      .filter({ has: page.getByText('Данные наблюдались', { exact: true }) }),
  ).toContainText('Неизвестно');
  await expect(
    cards
      .first()
      .getByRole('button', { name: 'Добавление недоступно', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      'API warning: partial catalog coverage; stock freshness unknown.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(cards.locator('input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Выбрать/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Проверить предложение', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Свернуть чат', exact: true }).click();
  await page.getByRole('button', { name: 'Қазақша', exact: true }).click();
  await page.getByLabel('Көмекшіні ашу', { exact: true }).click();
  await expect(cards.first()).toContainText('Бағасы белгісіз');
  await expect(cards.nth(1)).toContainText('1234.50 KZT');
  await expect(cards.nth(1)).not.toContainText('Валютасы белгісіз');
  await expect(cards.first()).toContainText('Каталог дереккөзі');
  await expect(cards.first()).toContainText('SYNTHETIC_TEST_FIXTURE');
  await expect(cards.first()).toContainText('Название из Catalog API');
  await expect(
    page.getByText(
      'API warning: partial catalog coverage; stock freshness unknown.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Аккаунтқа кіру', exact: true }),
  ).toBeVisible();
  expect(
    mock.records.filter((r) => r.path.includes('/cart/proposals')),
  ).toHaveLength(0);
});
