---
name: api-design
description: How to design a public or internal API (HTTP/REST, RPC, library) — predictable shape, evolvable, hard to misuse.
applies_to: [code, plan, draft-other]
---

# Skill: API design

## Goal

An API the next developer can use without reading the source, that you can evolve without breaking callers, and that's hard to misuse by accident. Most API regrets come from decisions made on day 1 — design slowly, ship deliberately.

## Foundational principles

1. **Make the easy thing easy and the hard thing possible.** The 80% case has zero options; the 20% case has all the knobs it needs.
2. **Consistency beats cleverness.** If naming, parameter order, and error-handling are consistent across endpoints, learners only need to learn once.
3. **Errors are part of the contract.** What status code, what body shape, what's stable across versions — design these before shipping.
4. **You will need to evolve it.** Plan for v2 from the first day of v1. Versioning, deprecation, additive-vs-breaking conventions.
5. **Don't leak implementation.** Internal field names, internal types, internal IDs that change when you refactor — keep them out of the public shape.

## HTTP / REST conventions

### Resources
- **Nouns, not verbs.** `/orders/:id` not `/getOrder?id=`.
- **Plural collections.** `/orders/123` not `/order/123`.
- **Nesting reflects ownership.** `/orders/:id/items` when items don't exist without the parent. Don't nest beyond 2 levels.

### Methods
| Method | Semantics |
|---|---|
| GET | Safe + idempotent. Never has side effects callers don't expect. |
| POST | Create a resource OR a non-CRUD action ("/orders/:id/refund") |
| PUT | Idempotent replace. Caller sends the full resource. |
| PATCH | Idempotent partial update. Caller sends just the deltas. |
| DELETE | Idempotent removal. Returns 204 or 404. |

### Status codes
- 200 — success with body
- 201 — created (usually with body + Location header)
- 204 — success, no body (often DELETE)
- 400 — bad request (validation, missing fields)
- 401 — not authenticated
- 403 — authenticated but not authorised
- 404 — resource doesn't exist OR caller can't see it (pick one; 403 leaks existence)
- 409 — conflict (e.g. duplicate)
- 422 — semantic validation failure (when 400 feels too generic)
- 429 — rate-limited (include `Retry-After`)
- 500 — your fault, surprised you, generic message to caller
- 503 — your fault, degraded, retry later

### Pagination
- Cursor-based for any unbounded collection. Offset pagination breaks on inserts/deletes.
- Return: `{ items: [...], next_cursor: "abc" | null }`. Caller passes `?cursor=abc`.
- Page size is bounded (e.g. 1-100, default 25). Reject anything outside.

### Errors

```json
{
  "error": {
    "code": "INVALID_FIELD",
    "message": "email must be a valid address",
    "field": "email",
    "request_id": "req_abc123"
  }
}
```

- Machine-readable `code` (don't break callers when you tweak `message`).
- Human-readable `message` (for logs and surfacing in UIs).
- `field` when the error is about a specific input.
- `request_id` for support to look up server-side.

## RPC conventions (gRPC, JSON-RPC)

- **Verb-noun methods.** `CreateOrder`, `ListOrders`, `RefundOrder`.
- **Request + response message per method.** Easier to evolve than positional args.
- **Use enums for fixed sets.** Strings are flexible but typo-prone.
- **Reserve field tags** in protobuf when you remove fields.

## Library / SDK conventions

- **Async by default** when I/O is involved. Sync wrappers can come later.
- **Builders / option bags** for >3 parameters. Positional arg lists rot.
- **Throw on programmer error** (wrong types, contract violations). Return `Result<T, E>` (or similar) for runtime / user errors.
- **Defaults that work** for the 80% case. Customisation is opt-in.

## Versioning

- **URL path versioning** is the simplest: `/v1/orders`, `/v2/orders`. Header-based versioning works but is invisible to debugging.
- **Additive changes don't bump the version.** New optional fields, new endpoints, new enum values (with `unknown` as a default for old clients).
- **Removing / renaming / changing types is breaking.** Bump major.
- **Deprecation:** mark in docs + return a `Deprecation` header pointing to the replacement. Don't remove until N months later.

## Output shape (when designing an API)

```
# API design: <name>

## Goals & non-goals
- ...

## Resources / methods

### `GET /orders`
- **Auth:** required
- **Query params:** `cursor`, `limit` (1-100, default 25), `status` (enum)
- **Response 200:**
  ```json
  { "items": [...], "next_cursor": "..." }
  ```
- **Errors:** 400 invalid status, 401 auth missing
- **Idempotency:** safe + cacheable

### `POST /orders`
- ...

## Versioning policy
<additive rules, deprecation timeline>

## Open questions
- <thing not decided>
```

## Rules

- **Design 3 example calls before specifying.** Imagine the SDK call sites — `orders.list({ status: "paid" })`. If the call site is awkward, the API is awkward.
- **Read the OpenAPI / proto spec back to a non-author.** If they can't predict what each field does, the names are wrong.
- **One way to do anything.** Two endpoints that almost do the same thing → callers pick badly, you maintain both forever.
- **Idempotency keys** for any POST that creates a resource. Saves customers from double-charges, double-orders.

## Pitfalls

- Leaking the database schema as the API. Pick names for the contract; map internally.
- Overloading GET with side-effects (auto-creating things on read). Breaks caches, breaks safety expectations.
- Returning different shapes from the same endpoint based on params — typed clients fight you.
- Mixing snake_case and camelCase in the same surface.
- 200 OK with `{ "error": "..." }` in the body — middleware can't tell success from failure.
