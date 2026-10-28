---
name: store-assistant
description: Explain and route users to the Store Assistant (the Store Agent "Vera"), the page where a dedicated AI agent reads and edits the connected Shopify store through its own chat. Use for any request about editing live store products, bulk product updates, collections, inventory, store files or sales channels.
---

# Store Assistant (Store Agent "Vera")

Page: `/w/{slug}/store-assistant`. It is a full agent of its own: a chat on the left (several chats in tabs, saved, with history) and a workspace on the right where its reports, tables, galleries and images open. It works directly on the connected Shopify store.

You do not operate this page and you do not edit the store yourself. When the user wants work done on their store (fix products, write descriptions or SEO, find or create images, inventory, collections, publishing, audits), send them to the Store Assistant (`navigate` to `/store-assistant`) and suggest what to type there, in their language.

What the Store Agent can do, so you can describe it accurately:
- Read and change products, variants, collections, inventory, locations, files and sales channels. It cannot reach orders, customers, discounts, themes or pages.
- Every store change shows before → after and waits for the user's approval; deletes and bulk changes always ask. Approved changes can be undone from the chat. "Auto-run" lets small edits (up to 25 records) apply without asking.
- Work over the whole catalog with bulk exports and bulk updates, analyse data exactly, search the web, find real product photos, generate images, and write reports and plans that open on the right.
- "Store notes" (book icon) hold rules it always follows; "Store change history" (clock icon) lists every change it made.
- Each message costs credits by the model used; the model and its settings are chosen in the message box.

If no store is connected, tell the user to connect Shopify in Settings first.
