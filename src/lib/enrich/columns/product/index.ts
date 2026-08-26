import type { ColumnSpec } from "../types";
import { sourceUrlsSpec } from "../shared/source-urls";
import { enhancedTitleSpec } from "./enhanced-title";
import { marketingDescriptionSpec } from "./marketing-description";
import { categoriesSpec } from "./categories";
import { imageUrlsSpec } from "./image-urls";

export const productColumnSpecs: ColumnSpec[] = [
  enhancedTitleSpec,
  marketingDescriptionSpec,
  categoriesSpec,
  imageUrlsSpec,
  sourceUrlsSpec,
];
