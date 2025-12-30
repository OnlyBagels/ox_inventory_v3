/**
 * Formats weight in grams to a display string.
 * @param grams - Weight in grams
 * @returns Formatted string like "150g" or "2.5kg"
 */
export function formatWeight(grams: number | undefined): string {
  if (grams === undefined || grams === null) return '';

  if (grams < 1000) {
    return `${Math.round(grams)}g`;
  }

  const kg = grams / 1000;
  // Show 1 decimal place if not a whole number, otherwise show whole number
  if (kg % 1 === 0) {
    return `${kg}kg`;
  }
  return `${kg.toFixed(1)}kg`;
}

/**
 * Formats inventory weight capacity display.
 * @param current - Current weight in grams
 * @param max - Maximum weight in grams
 * @returns Formatted string like "79.18/120.00kg"
 */
export function formatWeightCapacity(current: number, max: number): string {
  const currentKg = (current / 1000).toFixed(2);
  const maxKg = (max / 1000).toFixed(2);
  return `${currentKg}/${maxKg}kg`;
}

/**
 * Calculates weight percentage for progress bar.
 * @param current - Current weight in grams
 * @param max - Maximum weight in grams
 * @returns Percentage (0-100)
 */
export function getWeightPercentage(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, (current / max) * 100);
}
