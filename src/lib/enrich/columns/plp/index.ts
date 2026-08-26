import type { ColumnSpec } from "../types";
import { sourceUrlsSpec } from "../shared/source-urls";
import { seoTitleSpec } from "./seo-title";
import { metaDescriptionSpec } from "./meta-description";
import { h1Spec } from "./h1";
import { introCopySpec } from "./intro-copy";
import { seoCopySpec } from "./seo-copy";
import { targetKeywordSpec } from "./target-keyword";
import { secondaryKeywordsSpec } from "./secondary-keywords";
import { faqSpec } from "./faq";
import { parentCategorySpec } from "./parent-category";
import { internalLinksSpec } from "./internal-links";
import { slugSpec } from "./slug";
import { breadcrumbLabelSpec } from "./breadcrumb-label";

export const plpColumnSpecs: ColumnSpec[] = [
  seoTitleSpec,
  metaDescriptionSpec,
  h1Spec,
  introCopySpec,
  seoCopySpec,
  targetKeywordSpec,
  secondaryKeywordsSpec,
  faqSpec,
  parentCategorySpec,
  internalLinksSpec,
  slugSpec,
  breadcrumbLabelSpec,
  sourceUrlsSpec,
];
