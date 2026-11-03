// Amounts are authoritative integer paise, never supplied by the browser.
export const CREDIT_PACKAGES = {
  starter: { credits: 100, amount: 200000 },
  pro: { credits: 500, amount: 500000 },
  max: { credits: 2000, amount: 1000000 },
} as const;

export function getCreditPackage(packageId: unknown) {
  if (typeof packageId !== "string" || !Object.hasOwn(CREDIT_PACKAGES, packageId)) return null;
  return CREDIT_PACKAGES[packageId as keyof typeof CREDIT_PACKAGES];
}
