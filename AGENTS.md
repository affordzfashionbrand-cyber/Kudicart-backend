# KudiCart Backend — AGENTS.md (Repository Operating Directive)

> **Authority level:** This is the repo-level operating directive for `kudicart-backend/`. It **inherits** all rules from the workspace-root `.agents/AGENTS.md` and adds backend-specific constraints. If a rule here conflicts with the root directive, the root directive wins. If a rule here conflicts with `KudiCart_decisions.md`, the decisions file wins.

---

## 1. Repository Identity

| Property | Value |
|---|---|
| Repository | `kudicart-backend` |
| Technology | NestJS (TypeScript) — single REST API |
| Role | **Authoritative backend** for all four KudiCart clients |
| Database | Supabase-managed PostgreSQL |
| Hosting | AWS (App Runner / Elastic Beanstalk) |
| CI/CD | Jenkins |

This is the **single source of truth** for business logic, data persistence, authorization, payment verification, and all external integrations.

---

## 2. Repository-Level Document Map

```text
kudicart-backend/
├── AGENTS.md                ← THIS FILE
├── project_context.md       ← Backend project context
├── SPEC.md                  ← Backend requirements
├── decisions.md             ← Backend-specific locked decisions
├── design.md                ← Backend system design
├── PLAN.md                  ← Backend implementation plan (22 phases)
├── progress.md              ← Backend progress tracker
├── architecture_prompt.md   ← Backend architecture guidance
└── src/                     ← Application code (gated by §3)
```

### Context Loading Order

Before any backend work, read in this order:

```text
1. .agents/AGENTS.md              → workspace-wide rules
2. kudicart-backend/AGENTS.md     → THIS FILE (repo rules)
3. kudicart-backend/progress.md   → current phase, blockers
4. kudicart-backend/decisions.md  → locked tech + open decisions
5. kudicart-backend/PLAN.md       → active work package
6. KudiCart_progress.md           → master project state
```

---

## 3. Code-Creation Gate (Backend-Specific)

No backend application code may be created until:

1. The master `architecture.md` exists and is approved.
2. The active phase in `kudicart-backend/PLAN.md` is bound to concrete file paths.
3. The active phase is not blocked by an unresolved Open Decision from `kudicart-backend/decisions.md §4`.

Documentation (`*.md`) may be updated at any time.

---

## 4. Backend Technology Stack (Locked)

| Concern | Technology | Decision ID |
|---|---|---|
| Framework | NestJS (TypeScript) | D-015 |
| Database | Supabase PostgreSQL | D-016 |
| ORM | TypeORM or Prisma (OPEN — O-BE-01) | — |
| Auth Verification | Firebase Admin SDK | D-018 |
| Payment | Razorpay (server-side verification) | D-020 |
| Push Notifications | FCM via Firebase Admin SDK | D-019 |
| Media | Cloudinary | D-022 |
| Maps | Google Maps Platform | D-021 |
| Background Jobs | BullMQ + Redis (ElastiCache) | D-027 |
| Error Tracking | Sentry | D-023 |
| Hosting | AWS (App Runner / EB) | D-024 |
| CI/CD | Jenkins | D-026 |

**Do not** introduce alternative libraries that replace a locked technology (e.g., Stripe instead of Razorpay, Auth0 instead of Firebase).

---

## 5. Backend-Specific Business Invariants

These rules are **non-negotiable** in the backend codebase:

### 5.1 Single Backend Rule
One NestJS application serves all four clients. Do NOT create:
- Separate backend services per actor.
- Microservices without explicit architecture approval.
- Gateway/BFF layers not defined in the architecture.

### 5.2 Vendor Data Isolation (D-032)
Every vendor-scoped query MUST enforce `WHERE vendor_id = :vendorId`.
- This is a **data-access rule**, not a UI rule.
- Services must receive `vendor_id` from the authenticated request context.
- Never trust client-supplied `vendor_id` over the auth-resolved one.

### 5.3 RBAC Authority (D-033)
- Role checks happen in backend guards, NOT in client code.
- Use decorators: `@Roles(Role.ADMIN)`, `@Roles(Role.VENDOR)`, etc.
- Frontend route guards **supplement** but never **replace** backend authorization.

### 5.4 Payment Verification (D-020)
- Client-side Razorpay success is NEVER trusted.
- Backend verifies payment signature server-side with Razorpay API.
- Only verified payments update order state.

### 5.5 Order State Machine (D-034)
```text
PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
→ ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

Transition rules:
- **Vendor:** PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
- **Admin:** READY_FOR_PICKUP → ASSIGNED (manual rider selection)
- **Driver:** ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED

Every transition must:
1. Validate the current state.
2. Validate the actor's role/permission.
3. Record the transition in status history.
4. Trigger relevant business events (notification, ledger).

### 5.6 Manual Delivery Assignment Only (D-006)
- Admin manually selects a delivery partner.
- **Zero** automatic dispatch, nearest-rider matching, or geo-allocation logic.
- No background services that auto-assign riders.

### 5.7 Firebase-Only Auth (D-017, D-018)
- Firebase Admin SDK verifies all tokens server-side.
- No self-issued JWTs as primary identity.
- No second authentication system.

---

## 6. Backend Domain Modules

The backend organizes into these domain modules (exact structure TBD by architecture):

| Module | Responsibility | Key Invariants |
|---|---|---|
| `auth` | Firebase token verification, user/role resolution | D-017, D-018 |
| `users` | All actor profiles | O-001 (exact fields OPEN) |
| `vendors` | Vendor management, approval, scoping | D-032 (isolation) |
| `categories` | Category CRUD | Admin-only write |
| `products` | Catalog, pricing, stock, images | Vendor-scoped writes |
| `cart` | Cart operations | O-005 (multi-vendor OPEN) |
| `addresses` | Customer address CRUD | Customer-scoped |
| `orders` | Order lifecycle, state machine | D-034 (state machine) |
| `payments` | Razorpay integration, COD | D-020 (verification) |
| `delivery` | Manual assignment, driver status | D-006 (no auto-dispatch) |
| `notifications` | FCM dispatch, persistence, BullMQ | D-019 |
| `reviews` | Ratings and reviews | O-010 (eligibility OPEN) |
| `support` | Support tickets | O-011 (model OPEN) |
| `ledger` | Commission, earnings | O-013 (formula OPEN) |
| `media` | Cloudinary integration | D-022 |
| `audit` | Audit event logging | O-017 (catalog OPEN) |
| `reports` | Dashboard aggregations, CSV | O-014, O-015, O-016 (OPEN) |
| `common` | Guards, pipes, filters, decorators | Cross-cutting |

---

## 7. Backend-Specific Open Decisions

These are OPEN — do NOT invent resolutions. Stop and ask the user:

| ID | Decision | Impact |
|---|---|---|
| O-BE-01 | ORM choice (TypeORM vs Prisma) | Phase 1 — project foundation |
| O-001 | Exact actor profile fields | Users module entities |
| O-002 | Vendor staff model | Vendors module |
| O-003 | KYC fields/statuses | Driver profiles |
| O-004 | Product attributes/variants/taxes | Products module schema |
| O-005 | Multi-vendor cart behavior | Cart/order creation |
| O-006 | Checkout pricing composition | Order/payment |
| O-007 | Refund triggers/states | Payment module |
| O-008 | Order transition permission matrix | State machine |
| O-009 | Delivery tracking model | Delivery module |
| O-010 | Review eligibility rules | Reviews module |
| O-011 | Support ticket model | Support module |
| O-012 | Notification event catalog | Notification module |
| O-013 | Commission formulas | Ledger module |
| O-014–O-016 | Dashboard/report/CSV definitions | Reporting module |
| O-017 | Audit event catalog/retention | Audit module |
| O-019 | AWS hosting specifics (App Runner vs EB) | Deployment |

---

## 8. Backend Hard Exclusions

Do NOT create backend services, modules, endpoints, database tables, or BullMQ jobs for:

- Coupon engine / service
- Combo/bundle product service
- Delivery zone / serviceability engine
- Automatic rider dispatch / matching
- Route optimization service
- AI recommendation service
- Loyalty / referral / wallet service
- Subscription service
- Advanced inventory / warehouse service
- Live chat service
- Multi-language / multi-currency service
- BI / data warehouse / analytics platform
- Second payment gateway
- Second authentication system

---

## 9. API Contract Rules

- All endpoints require Firebase ID token in `Authorization` header.
- Public endpoints (catalog browsing) must be explicitly marked as such.
- Response shapes must be consistent and documented.
- DTOs must validate all input via NestJS validation pipes.
- Error responses must use consistent format with HTTP status codes.
- **Breaking changes** to API contracts must be flagged as cross-cutting and verified against all consuming repos.

---

## 10. Database Rules

- All schema changes require migration files.
- Vendor-scoped tables must include `vendor_id` column with appropriate indexes.
- Foreign key relationships must be explicit.
- Soft deletes vs hard deletes must follow the architecture decision.
- No raw SQL in business logic — use the ORM.
- No direct Supabase client-side access from frontend apps.

---

## 11. Testing Requirements

| Test Type | Required Before Phase Completion |
|---|---|
| Unit tests | Service/business logic functions |
| Integration tests | Module interactions, database queries |
| Auth tests | Token verification, RBAC guards |
| Vendor isolation tests | Cross-vendor data access prevention |
| Order state machine tests | All valid/invalid transitions |
| Payment tests | Razorpay verification flow |

Evidence must be recorded in `kudicart-backend/progress.md`.

---

## 12. Sync Rules

After completing any backend work unit, update:

| File | What |
|---|---|
| `kudicart-backend/progress.md` | Phase status, checklist items, evidence |
| `KudiCart_progress.md` | Master progress (if phase-level change) |
| `KudiCart_PLAN.md` | Phase status (if phase-level change) |

---

## 13. Self-Check (Backend-Specific)

Before completing any turn:

- [ ] Did I enforce vendor_id scoping on every vendor query? → If not, fix.
- [ ] Did I add backend RBAC guard for the endpoint? → If not, fix.
- [ ] Did I trust client-side payment success? → If yes, revert.
- [ ] Did I create auto-dispatch logic? → If yes, revert immediately.
- [ ] Did I create a module for an excluded feature? → If yes, delete it.
- [ ] Did I add a second auth/payment provider? → If yes, revert.
- [ ] Did I create a separate backend service per actor? → If yes, revert.
- [ ] Did I silently decide an OPEN item? → If yes, surface to user.
- [ ] Did I skip writing a database migration? → If yes, create it.
- [ ] Did I update progress.md with concrete evidence? → If not, do it now.
