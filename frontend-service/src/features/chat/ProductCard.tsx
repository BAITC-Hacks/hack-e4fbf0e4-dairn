import { useId, useState } from 'react';
import type { Product, Selection, Price } from '../../api/types';
import { safeLink } from '../../api/client';
import { Icon } from '../../components/Icon';
export function priceText(price: Price | null | undefined) {
  return price ? `${price.amount} ${price.currency}` : 'Цена неизвестна';
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
  const id = useId();
  const [warehouse, setWarehouse] = useState(
    product.stock?.find(
      (s) => s.available_quantity !== null && Number(s.available_quantity) > 0,
    )?.warehouse_id ||
      product.stock?.[0]?.warehouse_id ||
      '',
  );
  const [quantity, setQuantity] = useState(product.minimum_quantity || '1');
  const valid = validQuantity(quantity, product, warehouse);
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
      {product.source === 'synthetic' && (
        <span className="data-tag">Демо-товар · синтетические данные</span>
      )}
      <p className="product-price">
        {priceText(product.price)} <small>/ {product.unit}</small>
      </p>
      {product.stale && (
        <p className="warning">
          Данные устарели. Обновите товар перед выбором.
        </p>
      )}
      <details>
        <summary>Характеристики и наличие</summary>
        <dl>
          {Object.entries(product.attributes || {}).map(([key, value]) => (
            <div key={key}>
              <dt>
                {(
                  {
                    rated_current: 'Номинальный ток',
                    poles: 'Полюса',
                    curve: 'Характеристика',
                  } as Record<string, string>
                )[key] || key}
              </dt>
              <dd>{value === null ? 'Неизвестно' : String(value)}</dd>
            </div>
          ))}
        </dl>
        {product.stock?.length ? (
          product.stock.map((stock) => (
            <p key={stock.warehouse_id}>
              {stock.warehouse_id}:{' '}
              {stock.available_quantity === null
                ? 'Остаток неизвестен'
                : `${stock.available_quantity} ${product.unit}`}
            </p>
          ))
        ) : (
          <p>Остатки неизвестны</p>
        )}
        <small>
          Обновлено:{' '}
          {product.observed_at
            ? new Date(product.observed_at).toLocaleString('ru-RU')
            : 'неизвестно'}
        </small>
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
              {certificate.name || 'Сертификат'} ↗
            </a>
          ) : (
            <p key={index}>
              Ссылка на сертификат недоступна: источник не подтверждён.
            </p>
          );
        })}
      </details>
      <div className="product-selection">
        <label htmlFor={`${id}-warehouse`}>
          Склад
          <select
            id={`${id}-warehouse`}
            value={warehouse}
            onChange={(event) => setWarehouse(event.target.value)}
            disabled={disabled}
          >
            <option value="" disabled>
              Выберите склад
            </option>
            {product.stock?.map((s) => (
              <option key={s.warehouse_id} value={s.warehouse_id}>
                {s.warehouse_id === 'demo-almaty'
                  ? 'Алматы · демо'
                  : s.warehouse_id}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-quantity`}>
          Количество, {product.unit}
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
        Мин. {product.minimum_quantity || 'неизвестно'} · шаг{' '}
        {product.quantity_step || 'неизвестен'}
        {!valid && ' · проверьте количество и остаток'}
      </small>
      <button
        className="secondary full-width"
        disabled={disabled || !valid || !product.price || product.stale}
        onClick={() =>
          onSelect(product, {
            product_id: product.id,
            warehouse_id: warehouse,
            quantity,
          })
        }
      >
        Выбрать {quantity} {product.unit}
        <Icon name="check" size={16} />
      </button>
    </article>
  );
}
