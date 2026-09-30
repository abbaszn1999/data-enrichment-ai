import type { ColumnSpec } from "../types";
import { sourceUrlsSpec } from "../shared/source-urls";
import { faqSpec } from "../plp/faq";
import { enhancedTitleSpec } from "./enhanced-title";
import { marketingDescriptionSpec } from "./marketing-description";
import { titleTagSpec } from "./title-tag";
import { productSpecificationsSpec } from "./product-specifications";
import { categoriesSpec } from "./categories";
import { imageUrlsSpec } from "./image-urls";

// enhancedTitle and sourceUrls are no longer Enrich defaults but stay
// registered so older sessions and saved presets keep running.
export const productColumnSpecs: ColumnSpec[] = [
  titleTagSpec,
  marketingDescriptionSpec,
  productSpecificationsSpec,
  faqSpec,
  enhancedTitleSpec,
  categoriesSpec,
  imageUrlsSpec,
  sourceUrlsSpec,
];
