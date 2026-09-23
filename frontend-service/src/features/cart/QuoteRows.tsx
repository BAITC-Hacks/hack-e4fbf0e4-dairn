import { useLocale } from '../../i18n/LocaleProvider';
import type { Quote } from '../../api/types';
import { priceText } from '../chat/ProductCard';
export function QuoteRows({ items }: { items: Quote[] }) {
  const { t } = useLocale();
  return (
    <ul className="quote-list">
      {items.map((item) => (
        <li key={`${item.selection.product_id}-${item.selection.warehouse_id}`}>
          <strong>{item.name}</strong>
          <span>
            {item.sku} · {item.selection.warehouse_id}
          </span>
          <span>
            {item.selection.quantity}{' '}
            {item.unit || t('Единица измерения неизвестна')} ×{' '}
            {priceText(item.price, t)}
            {item.unit && ` / ${item.unit}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
