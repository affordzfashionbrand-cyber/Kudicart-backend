# KudiCart Backend — Architecture Prompt

> **Purpose:** Guide creation of the Backend's detailed architecture.

---

# 1. Context

The KudiCart Backend is a single NestJS application serving all four client applications (Customer App, Driver App, Admin/Vendor Web). It is the authoritative source for all business logic, data persistence, and external integrations.

---

# 2. Architecture Decisions Required

## NestJS Application Structure
- Module organization.
- Controller / Service / Repository pattern.
- DTOs and validation.
- Guards (Auth, RBAC, Vendor Scope).
- Interceptors (Audit, Logging, Transform).
- Filters (Exception handling).
- Pipes (Validation).

## Database Architecture
- PostgreSQL schema design.
- Entity relationships.
- Migration strategy.
- ORM choice (TypeORM vs Prisma).
- Indexing strategy.
- Transaction boundaries.
- Vendor-scope enforcement at query level.

## Module Boundaries

Define concrete modules with their responsibilities:

```text
auth/        → Firebase token verification, user/role resolution
users/       → Customer, Vendor, Admin, Driver profiles
vendors/     → Vendor management, approval, scoping
categories/  → Category CRUD
products/    → Product CRUD, pricing, stock, media
cart/        → Cart operations
addresses/   → Address management
orders/      → Order creation, state machine, transitions
payments/    → Razorpay integration, verification, COD
delivery/    → Manual assignment, status updates, tracking
notifications/ → FCM dispatch, persistence, queuing
reviews/     → Reviews and ratings
support/     → Support tickets
ledger/      → Commission, earnings, payouts
media/       → Cloudinary integration
reports/     → Aggregations, CSV export
audit/       → Audit logging
common/      → Shared guards, pipes, filters, decorators, utils
```

## Authentication Architecture
- Firebase Admin SDK integration.
- Auth guard implementation.
- Token verification flow.
- User/role resolution flow.
- Request context population.

## Authorization Architecture
- RBAC guard implementation.
- Role decorator pattern.
- Role permission matrix.
- Vendor scope guard.

## Order State Machine Architecture
- State machine implementation.
- Transition validation.
- Role-based transition permissions.
- State history recording.
- Business event triggering.

## Payment Architecture
- Razorpay SDK integration.
- Order creation flow.
- Signature verification.
- Webhook handling (if applicable).
- COD handling.

## Notification Architecture
- FCM Admin SDK integration.
- BullMQ queue/worker pattern.
- Event → notification mapping.
- Device token management.

## Background Job Architecture
- BullMQ queue configuration.
- Worker processes.
- Job types and priorities.
- Error handling and retries.

## Media Architecture
- Cloudinary SDK integration.
- Upload flow.
- URL management.
- File size/type validation.

## External Integration Architecture
- Firebase Admin SDK.
- Razorpay SDK.
- Cloudinary SDK.
- Google Maps Platform.
- FCM.
- Sentry.

---

# 3. Database Schema (High-Level)

Key entities:

```text
users
vendors
delivery_partners
categories
products
product_images
cart_items
addresses
orders
order_items
order_status_history
payments
delivery_assignments
notifications
reviews
support_tickets
ledger_entries
audit_events
```

---

# 4. Constraints

1. Single NestJS backend for all clients.
2. Backend is the single authority for business logic.
3. Razorpay only payment gateway.
4. Firebase only auth provider.
5. Manual rider assignment only.
6. Vendor isolation mandatory.
7. No excluded features.
8. AWS hosting.
9. Jenkins CI/CD.

---

# 5. Architecture Output Expected

1. Complete folder/module structure with responsibilities.
2. Database schema overview with entity relationships.
3. Authentication/authorization architecture.
4. API endpoint organization.
5. Order state machine implementation.
6. Payment integration architecture.
7. Notification/FCM architecture.
8. Background job architecture.
9. Media architecture.
10. Error handling patterns.
11. Testing strategy.
12. Migration strategy.
13. Deployment architecture (AWS).
14. CI/CD pipeline (Jenkins).
15. Environment/secrets management.
16. Dependency rules (what may depend on what).
17. Security boundaries.

---

# 6. Explicit Exclusions

Do NOT architect:
- Coupon/combo/loyalty/wallet/subscription services.
- Automatic dispatch/matching services.
- Delivery zone/serviceability services.
- Route optimization services.
- AI recommendation services.
- BI/data warehouse platform.
- Live chat platform.
- Multi-language/multi-currency services.
- Separate backends per actor.
- Direct client-to-database access.
