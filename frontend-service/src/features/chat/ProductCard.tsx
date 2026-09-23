import { useLocale } from '../../i18n/LocaleProvider';
import { translators, type Translate } from '../../i18n/messages';
import { useId, useState } from 'react';
import type {
  CatalogMetadata,
  Product,
  Selection,
  Price,
} from '../../api/types';
import { safeLink } from '../../api/client';
import { Icon } from '../../components/Icon';
export function priceText(
  price: Price | null | undefined,
  t: Translate = translators.ru,
) {
  return price
    ? `${price.amount} ${price.currency || `(${t('Валюта неизвестна')})`}`
    : t('Цена неизвестна');
}

export function CatalogMetadataDetails({
  metadata,
}: {
  metadata: CatalogMetadata;
}) {
  const { t, dateLocale } = useLocale();
  const timestamp = (value: string | null) => {
    if (!value) return t('Неизвестно');
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString(dateLocale);
  };
  const rows = [
    [t('Источник каталога'), metadata.source],
    [t('Режим данных'), metadata.mode],
    [t('Полнота каталога'), metadata.coverage],
    [t('Актуальность данных'), metadata.freshness],
    [t('Уровень детализации'), metadata.detailLevel],
    [t('Загружено товаров'), metadata.loadedProducts],
    [t('Всего товаров'), metadata.totalProducts ?? t('Неизвестно')],
    [t('Загруженные страницы'), metadata.pages.join(', ') || t('Неизвестно')],
    [t('Данные наблюдались'), timestamp(metadata.observedAt)],
    [t('Снимок загружен'), timestamp(metadata.loadedAt)],
    [t('Срок актуальности'), timestamp(metadata.expiresAt)],
  ];
  if (metadata.fallbackReason)
    rows.push([t('Причина резервного источника'), metadata.fallbackReason]);
  return (
    <dl className="catalog-metadata">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function validQuantity(
  quantity: string,
  product: Product,
  warehouse: string,
): boolean {
  const stock = product.stock?.find(
    (item) => item.warehouse_id === warehouse,
  )?.available_quantity;
  const values = [
    quantity,
    product.quantity_step,
    product.minimum_quantity,
    stock,
  ];
  if (
    values.some(
      (value) =>
        typeof value !== 'string' ||
        !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
        value.length > 30,
    )
  )
    return false;
  const decimals = Math.max(
    ...values.map((value) => value!.split('.')[1]?.length || 0),
  );
  const scaled = values.map((value) =>
    BigInt(
      value!.replace('.', '') +
        '0'.repeat(decimals - (value!.split('.')[1]?.length || 0)),
    ),
  );
  const [amount, step, minimum, available] = scaled;
  return (
    amount > 0n &&
    step > 0n &&
    amount >= minimum &&
    amount % step === 0n &&
    amount <= available
  );
}
interface ProductCardProps {
  product: Product;
  disabled: boolean;
  onSelect: (product: Product, selection: Selection) => void;
}
export function ProductCard({ product, disabled, onSelect }: ProductCardProps) {
  const { t, dateLocale } = useLocale();
  const id = useId();
  const [warehouse, setWarehouse] = useState(
    product.stock?.find(
      (s) => s.available_quantity !== null && Number(s.available_quantity) > 0,
    )?.warehouse_id ||
      product.stock?.[0]?.warehouse_id ||
      '',
  );
  const [quantity, setQuantity] = useState(product.minimum_quantity || '');
  const valid = validQuantity(quantity, product, warehouse);
  const metadata = product.catalog_metadata;
  const simulatedAvailability =
    typeof product.availability === 'object' && product.availability?.simulated
      ? product.availability
      : null;
  const unit = product.unit || t('Единица измерения неизвестна');
  const productUrl = product.pageUrl
    ? safeLink(product.pageUrl, 'product')
    : null;
  return (
    <article className="product-card">
      <div className="product-top">
        <span className="product-glyph">
          <Icon name="bolt" size={25} />
        </span>
        <div>
          <span className="sku">{product.sku}</span>
          <h4>{product.name}</h4>
        </div>
      </div>
      {(product.source === 'synthetic' ||
        metadata?.source === 'SYNTHETIC_TEST_FIXTURE') && (
        <span className="data-tag">
          {t('Демо-товар · синтетические данные')}
        </span>
      )}
      <p className="product-price">
        {priceText(product.price, t)}{' '}
        <small>{product.unit ? `/ ${product.unit}` : unit}</small>
      </p>
      {simulatedAvailability && (
        <small className="data-tag">
          {t('Смоделированный остаток:')}{' '}
          {simulatedAvailability.quantity ?? t('Остаток неизвестен')}
          {product.unit ? ` ${product.unit}` : ''}
        </small>
      )}
      {metadata?.coverage === 'PARTIAL' && (
        <p className="warning">
          {t('Каталог загружен частично. Показаны только доступные данные.')}
        </p>
      )}
      {metadata && metadata.freshness !== 'FRESH' && (
        <p className="warning">{t('Актуальность данных не подтверждена.')}</p>
      )}
      {!metadata && product.stale && (
        <p className="warning">
          {t('Данные устарели. Обновите товар перед выбором.')}
        </p>
      )}
      <details>
        <summary>{t('Характеристики и наличие')}</summary>
        {metadata && <CatalogMetadataDetails metadata={metadata} />}
        {!Object.keys(product.attributes || {}).length && (
          <p>{t('Характеристики не предоставлены.')}</p>
        )}
        <dl>
          {Object.entries(product.attributes || {}).map(([key, value]) => (
            <div key={key}>
              <dt>
                {(
                  {
                    rated_current: t('Номинальный ток'),
                    poles: t('Полюса'),
                    curve: t('Характеристика'),
                  } as Record<string, string>
                )[key] || key}
              </dt>
              <dd>{value === null ? t('Неизвестно') : String(value)}</dd>
            </div>
          ))}
        </dl>
        {product.availability && (
          <p>
            {t('Наличие:')}{' '}
            {typeof product.availability === 'string'
              ? product.availability
              : product.availability.status}
          </p>
        )}
        {typeof product.availability === 'object' && !simulatedAvailability && (
          <p>
            {t('Количество по каталогу:')}{' '}
            {product.availability.quantity === null
              ? t('Остаток неизвестен')
              : `${product.availability.quantity} ${unit}`}
          </p>
        )}
        {product.stock?.length ? (
          product.stock.map((stock) => (
            <p key={stock.warehouse_id}>
              {stock.warehouse_id}:{' '}
              {stock.available_quantity === null
                ? t('Остаток неизвестен')
                : `${stock.available_quantity} ${unit}`}
            </p>
          ))
        ) : (
          <p>
            {t(
              simulatedAvailability
                ? 'Остатки по складам не предоставлены.'
                : 'Остатки неизвестны',
            )}
          </p>
        )}
        {!metadata && (
          <small>
            {t('Обновлено:')}{' '}
            {product.observed_at
              ? new Date(product.observed_at).toLocaleString(dateLocale)
              : t('неизвестно')}
          </small>
        )}
        {!product.certificates?.length && (
          <p>{t('Сведения о сертификатах не предоставлены.')}</p>
        )}
        {(product.certificates || []).map((certificate, index) => {
          const url = safeLink(certificate.url, 'certificate');
          return url ? (
            <a
              className="certificate"
              key={index}
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {certificate.name || t('Сертификат')} ↗
            </a>
          ) : (
            <p key={index}>
              {t('Ссылка на сертификат недоступна: источник не подтверждён.')}
            </p>
          );
        })}
      </details>
      {productUrl ? (
        <a
          className="certificate"
          href={productUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('Открыть товар на сайте')} ↗
        </a>
      ) : metadata ? (
        <p>
          {product.pageUrl
            ? t('Ссылка на товар недоступна: источник не подтверждён.')
            : t('Ссылка на товар не предоставлена.')}
        </p>
      ) : null}
      {metadata ? (
        <>
          <p className="warning" id={`${id}-cart-unavailable`}>
            {t('Корзина партнёра ещё не подключена. Добавление недоступно.')}
          </p>
          <button
            className="secondary full-width"
            disabled
            aria-describedby={`${id}-cart-unavailable`}
          >
            {t('Добавление недоступно')}
          </button>
        </>
      ) : (
        <>
          <div className="product-selection">
            <label htmlFor={`${id}-warehouse`}>
              {t('Склад')}{' '}
              <select
                id={`${id}-warehouse`}
                value={warehouse}
                onChange={(event) => setWarehouse(event.target.value)}
                disabled={disabled}
              >
                <option value="" disabled>
                  {t('Выберите склад')}
                </option>
                {product.stock?.map((s) => (
                  <option key={s.warehouse_id} value={s.warehouse_id}>
                    {s.warehouse_id === 'demo-almaty'
                      ? t('Алматы · демо')
                      : s.warehouse_id}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-quantity`}>
              {t('Количество,')} {unit}
              <input
                id={`${id}-quantity`}
                inputMode="decimal"
                value={quantity}
                onChange={(event) =>
                  setQuantity(event.target.value.replace(',', '.'))
                }
                aria-describedby={`${id}-limits`}
                disabled={disabled}
                maxLength={30}
              />
            </label>
          </div>
          <small id={`${id}-limits`}>
            {t('Мин.')} {product.minimum_quantity || t('неизвестно')}{' '}
            {t('· шаг')} {product.quantity_step || t('неизвестен')}
            {!valid && <> {t('· проверьте количество и остаток')}</>}
          </small>
          <button
            className="secondary full-width"
            disabled={
              disabled ||
              !valid ||
              !product.price?.currency ||
              !product.unit ||
              product.stale
            }
            onClick={() =>
              onSelect(product, {
                product_id: product.id,
                warehouse_id: warehouse,
                quantity,
              })
            }
          >
            {t('Выбрать {quantity} {unit}', { quantity, unit })}
            <Icon name="check" size={16} />
          </button>
        </>
      )}
    </article>
  );
}
