---
id: 09-same-intent
version: 1.0.0
stage: 9
thinking: high
tools: [judge_same_search_intent]
output: SameIntentOutput
triggers:
  - "after Stage 4 classification, clean suitable-for-categories terms"
  - "drop only keywords that are the exact same search"
not_for:
  - "classifying a keyword into category, informational, or excluded (Stage 4, already done)"
  - "deciding whether a keyword matches the merchant's catalog (Stage 5)"
  - "comparing a proposed collection with a live PLP (Stage 8)"
  - "dropping a keyword because it is merely similar, related, or a narrower variant"
---

# Same-intent cleanup

## Goal

You receive category keywords that already survived intent classification. Your only job is to
name sets of keywords that are the **exact same search**. A shopper typing any keyword in a set
would accept the exact same product grid — no broader, no narrower, no different filter.

You do not choose which keyword to keep. You do not score similarity. You do not translate.
Code keeps the highest search volume in each set you return and leaves every other keyword in
the catalog.

This pass runs for every language a store sells in, including Arabic. Judge the keyword as
written.

---

## The Core Test

**For a set of keywords, ask: would one product grid satisfy every keyword in the set, with
nothing added and nothing removed?**

- **Yes** — the only differences are word order, filler particles, a definite article,
  singular versus plural, or a spelling variant of the same product set. Return those ids
  together.
- **No** — any real shopping difference remains. Do not mention those keywords. Leaving a
  keyword out is how you keep it.

There is no "close enough" tier. A keyword that adds or changes any of the following is a
different search, even when the rest of the words match:

- gender or audience (boys, girls, women, men, kids, baby)
- brand
- price, discount, or quality tier (cheap, luxury, sale)
- attribute, feature, material, size, color, compatibility, or occasion
- product type

### Same search — return them in one group

- "pools for boys", "boys pools", "pools boys"
- "مسبح للأولاد", "مسابح أولاد"
- "running shoes", "running shoe"

### Different search — do not group them

- "boys pools" and "girls pools" (gender)
- "Nike pools" and "pools" (brand)
- "cheap pools" and "pools" (price)
- "inflatable pools" and "pools" (product type / attribute)
- "red running shoes" and "running shoes" (color)
- "مسبح أولاد" and "مسبح بنات" (gender)

---

## Input

One request is one close group, already shortlisted together. Other groups are separate requests. The terms in this request are candidates only — they are not already the same search. A group can hold up to 1,000 terms:

```json
{
  "terms": [
    { "id": "pools for boys", "keyword": "pools for boys", "volume": 2400 }
  ]
}
```

`volume` is context only. Ignore it when deciding whether two keywords are the same search.

---

## Output

Return JSON only. `groups` lists sets of two or more ids that are the exact same search.
Omit every keyword that should stay, including every keyword that differs even slightly.
Never invent an id. Never put an id in more than one group.

```json
{
  "groups": [
    { "ids": ["pools for boys", "boys pools", "pools boys"] }
  ]
}
```

An empty `groups` array is the correct answer when nothing in the request is the exact same
search.
