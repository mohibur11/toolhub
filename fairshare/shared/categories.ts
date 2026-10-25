export interface Category {
  id: string;
  label: string;
  emoji: string;
}

export const CATEGORIES: Category[] = [
  { id: 'general', label: 'General', emoji: '🧾' },
  { id: 'food', label: 'Food & dining', emoji: '🍽️' },
  { id: 'groceries', label: 'Groceries', emoji: '🛒' },
  { id: 'drinks', label: 'Drinks & snacks', emoji: '🥤' },
  { id: 'transport', label: 'Transport', emoji: '🚕' },
  { id: 'flight', label: 'Flights', emoji: '✈️' },
  { id: 'fuel', label: 'Fuel', emoji: '⛽' },
  { id: 'hotel', label: 'Hotel & stay', emoji: '🏨' },
  { id: 'rent', label: 'Rent', emoji: '🏠' },
  { id: 'utilities', label: 'Utilities', emoji: '💡' },
  { id: 'tickets', label: 'Tickets & activities', emoji: '🎟️' },
  { id: 'entertainment', label: 'Entertainment', emoji: '🎬' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'health', label: 'Health', emoji: '💊' },
  { id: 'gifts', label: 'Gifts', emoji: '🎁' },
  { id: 'other', label: 'Other', emoji: '📦' },
];

export function categoryOf(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}
