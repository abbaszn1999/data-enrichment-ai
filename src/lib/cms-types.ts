export const SUPPORTED_CMS_TYPES = ["shopify", "woocommerce"] as const;

export type SupportedCmsType = (typeof SUPPORTED_CMS_TYPES)[number];

export type CmsTypeOption = {
  value: string;
  label: string;
  available: boolean;
};

export const CMS_TYPES: CmsTypeOption[] = [
  { value: "shopify", label: "Shopify", available: true },
  { value: "woocommerce", label: "WooCommerce", available: true },
  { value: "bigcommerce", label: "BigCommerce", available: false },
  { value: "salla", label: "Salla", available: false },
  { value: "zid", label: "Zid", available: false },
  { value: "magento", label: "Magento", available: false },
  { value: "custom", label: "Custom / Other", available: false },
];

export const DEFAULT_CMS_TYPE: SupportedCmsType = "shopify";

export function isSupportedCmsType(value: string): value is SupportedCmsType {
  return SUPPORTED_CMS_TYPES.includes(value as SupportedCmsType);
}

export function parseSupportedCmsType(
  value: string | null | undefined
): SupportedCmsType {
  return value && isSupportedCmsType(value) ? value : DEFAULT_CMS_TYPE;
}

export function cmsTypeLabel(value: string): string {
  return CMS_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function cmsTypeOptionLabel(option: CmsTypeOption): string {
  return option.available ? option.label : `${option.label} — Coming soon`;
}
