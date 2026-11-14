// Part prices, one rule for quotes (WA / Proposal lines) and invoices (the invoicing sheet):
//   1. the property's own price for that kind of part (WA Notes > Prices), when set;
//   2. otherwise the catalog part, at its newest price on or before the date.
// A combo (transmitter and meter in one) uses the property's transmitter price.
import type { PropertyPrices } from './systemnotes';

export const PROPERTY_PRICE_ITEM: Record<string, string> = { transmitter: 'Transmitter', meter: 'Meter', combo: 'Transmitter', both: 'Transmitter' };

/** The property's own price for a component, or undefined when it has none. */
export function propertyPartPrice(prices: PropertyPrices, component: string | null | undefined): number | undefined {
  const item = component ? PROPERTY_PRICE_ITEM[component] : undefined;
  return item !== undefined ? prices[item] : undefined;
}
