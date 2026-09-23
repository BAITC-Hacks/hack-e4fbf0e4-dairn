import { describe, expect, it } from 'vitest';
import { safeLink } from '../api/client';
import { validQuantity } from '../features/chat/ProductCard';
import type { Product } from '../api/types';
const product: Product = {
  id: 'p1',
  sku: 'P1',
  name: 'Cable',
  price: null,
  unit: 'м',
  quantity_step: '0.1',
  minimum_quantity: '0.2',
  stock: [{ warehouse_id: 'w1', available_quantity: '0.3' }],
};
describe('product quantities and trusted links', () => {
  it('uses decimal precision for step, minimum and stock validation', () => {
    expect(validQuantity('0.3', product, 'w1')).toBe(true);
    for (const value of ['0.1', '0.25', '0.4', '0', '-1', 'NaN', '1e2'])
      expect(validQuantity(value, product, 'w1')).toBe(false);
    expect(
      validQuantity(
        '0.2',
        {
          ...product,
          stock: [{ warehouse_id: 'w1', available_quantity: null }],
        },
        'w1',
      ),
    ).toBe(false);
  });
  it('rejects scripts, credentials and untrusted origins', () => {
    expect(safeLink('javascript:alert(1)', 'certificate')).toBeNull();
    expect(
      safeLink('https://ekt.kz.attacker.test/file.pdf', 'certificate'),
    ).toBeNull();
    expect(
      safeLink('https://secret@ekt.kz/file.pdf', 'certificate'),
    ).toBeNull();
    expect(safeLink('https://ekt.kz/file.pdf', 'certificate')).toBe(
      'https://ekt.kz/file.pdf',
    );
    expect(safeLink('https://evil.test/cart', 'cart')).toBeNull();
    expect(safeLink('/cart?session_id=demo', 'cart')).toContain(
      '/cart?session_id=demo',
    );
  });
});
