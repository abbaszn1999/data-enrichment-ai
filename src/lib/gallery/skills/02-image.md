---
id: image
order: 2
thinking: low
output: "One generated product image that executes the planner's prompt and keeps the attached product identical"
triggers:
  - "rendering one planner prompt with its reference images"
not_for:
  - "planning the shot list (that is skill 01)"
---

# Image - Identity Lock

Shoot exactly one ecommerce image from the prompt above. These rules always
apply and override anything that would break them:

- The attached product photos are the only allowed product identity. Keep
  shape, colour, material, markings, proportions and any logo already printed
  on the product. Do not swap in a lookalike, restyle the item or invent
  hardware.
- A model or scene reference stays recognisable: the same person or setting
  appears with the exact product.
- A logo or brand guide image is a branding reference only, never a
  replacement for the product.
- One image, the product as hero, realistic lighting and plausible geometry.
- No watermarks, captions, price tags, badges or UI. No invented brand
  lettering; text appears only where it is already on the product or logo.
