# KudiCart Backend — Project Context

> **Purpose:** Durable project context for the KudiCart Common Backend Application.
>
> This file covers the **NestJS Backend** — the single authoritative source of business logic, data persistence, authorization, and external integrations for the entire KudiCart marketplace.
>
> For client applications, see `kudicart-customer-app/`, `kudicart-driver-app/`, and `kudicart-admin-vendor-web/`.

---

# 1. Repository Overview

This repository contains the **KudiCart Common Backend** — a NestJS (TypeScript) application serving all four actors (Customer, Delivery Partner, Vendor, Admin) through a unified REST API.

The backend is the **single authority** for:

- Business rules and domain logic.
- Data persistence (PostgreSQL via Supabase).
- Authentication verification (Firebase token validation).
- Role-based access control (RBAC).
- Vendor data isolation.
- Payment verification (Razorpay server-side).
- Order state machine enforcement.
- Commission/ledger calculations.
- Notification dispatch (FCM server-side).
- Media management (Cloudinary).
- Background job processing (BullMQ/Redis).
- Audit logging.

---

# 2. System Position

```text
kudicart-customer-app  ───┐
kudicart-driver-app    ───┤  REST API
kudicart-admin-vendor-web ┘
        ↓
  KudiCart Backend  ← THIS REPOSITORY
        ↓
  ┌──────────────────────────────────────┐
  │  Supabase PostgreSQL (Primary DB)     │
  │  Redis (BullMQ - Background Jobs)     │
  │  Firebase (Auth Verification + FCM)   │
  │  Razorpay (Payment Verification)      │
  │  Cloudinary (Media Storage/CDN)       │
  │  Google Maps (Geocoding/Directions)   │
  │  Sentry (Error Tracking)              │
  └──────────────────────────────────────┘
```

All three client applications connect to this single backend. No client connects directly to the database.

---

# 3. Prototype Reference

`https://prototypedemo-mocha.vercel.app/`

The prototype informs UX but does NOT automatically create API requirements. Written specifications are authoritative.

---

# 4. Four Actors Served

### Customer
- Authentication (phone/OTP via Firebase).
- Profile management.
- Catalog browsing.
- Cart, checkout, order placement.
- Payment initiation.
- Order tracking.
- Reviews and ratings.
- Notifications.
- Support tickets.

### Delivery Partner
- Authentication (phone/OTP via Firebase).
- Profile and KYC status.
- Availability management.
- Assigned order visibility.
- Pickup/delivery status updates.
- Location/tracking data.
- Notifications.

### Vendor
- Authentication (email/password via Firebase).
- Vendor profile.
- Own product/catalog management.
- Own pricing and stock.
- Own order management.
- Permitted order status transitions.

### Admin
- Authentication (email/password via Firebase).
- Full marketplace visibility.
- User/vendor/partner management.
- Category/product management.
- Order management.
- Manual delivery assignment.
- Payment/commission/ledger visibility.
- Reviews/support management.
- Reporting/CSV.
- Audit visibility.

---

# 5. Technology Stack

| Concern | Technology |
|---|---|
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL (Supabase-managed) |
| ORM | TypeORM or Prisma (TBD by architecture) |
| Authentication | Firebase Admin SDK (token verification) |
| Payment | Razorpay (server-side verification) |
| Push Notifications | Firebase Cloud Messaging (Admin SDK) |
| Media | Cloudinary (upload, processing, CDN) |
| Maps | Google Maps Platform (geocoding, directions) |
| Background Jobs | BullMQ + Redis |
| Error Tracking | Sentry |
| Hosting | AWS (App Runner or Elastic Beanstalk) |
| CI/CD | Jenkins |

---

# 6. Backend Owns (Authoritative)

- All business rule enforcement.
- All data validation and persistence.
- Firebase ID token verification.
- Role/permission resolution and RBAC.
- Vendor-scope data isolation.
- Order state machine (transitions, validation).
- Payment verification with Razorpay.
- Commission/ledger calculation and recording.
- FCM notification dispatch.
- Cloudinary media operations.
- Background job orchestration.
- Audit event recording.
- All API endpoint authorization.

---

# 7. Backend Does NOT Own

- Client-side UI/UX.
- Firebase user creation (clients initiate Firebase auth).
- Razorpay payment UI (clients present Razorpay SDK).
- Client-side error display.

---

# 8. Critical Business Rules

### Order State Machine

```text
PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
→ ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

State transitions are role-gated:
- **Vendor:** PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
- **Admin:** READY_FOR_PICKUP → ASSIGNED (manual assignment)
- **Driver:** ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED

### Payment Verification

```text
Client initiates Razorpay → Razorpay processes → Client sends result
→ Backend verifies with Razorpay server-side → Records payment state
```

Client-side payment success is NEVER trusted.

### Vendor Isolation

Every vendor-scoped query/mutation must enforce vendor_id filtering. No vendor may access another vendor's data.

---

# 9. Business Domains

| Domain | Responsibility |
|---|---|
| Auth | Firebase token verification, user/role resolution |
| Users | Customer/vendor/admin/driver profiles |
| Vendors | Vendor management, approval, scoping |
| Categories | Category CRUD |
| Products | Product/catalog CRUD, pricing, stock, media |
| Cart | Cart operations |
| Addresses | Customer address management |
| Orders | Order lifecycle, state machine, transitions |
| Payments | Razorpay integration, verification, COD |
| Delivery | Assignment, pickup/delivery workflow, tracking |
| Notifications | Event → notification → FCM dispatch |
| Reviews | Ratings and reviews |
| Support | Support tickets |
| Ledger | Commission, earnings, payouts |
| Media | Cloudinary integration |
| Audit | Write-action audit logging |
| Reports | Aggregations, CSV export |

---

# 10. External Integrations

| Service | Backend Responsibility |
|---|---|
| Firebase Admin SDK | Verify ID tokens, resolve UID → app user |
| Razorpay | Create orders, verify payments, handle webhooks |
| FCM (Firebase) | Send push notifications to devices |
| Google Maps | Geocoding, directions (server-side where needed) |
| Cloudinary | Upload media, generate URLs, image processing |
| Sentry | Server-side error capture |
| Redis | BullMQ job queue for background processing |

---

# 11. Background Jobs (BullMQ/Redis)

| Job Type | Purpose |
|---|---|
| Notification dispatch | Queue FCM push sends |
| Audit logging | Async audit record creation |
| CSV generation | Generate large CSV exports |
| Cloudinary processing | Async media operations if needed |

---

# 12. Hard Scope Exclusions

The backend must NOT implement:

- Coupon engine / service.
- Combo/bundle engine.
- Delivery zone / serviceability engine.
- Automatic rider dispatch / matching.
- Route optimization.
- AI recommendation engine.
- Loyalty / referral / wallet.
- Subscription system.
- Advanced inventory / warehouse system.
- Live chat platform.
- Multi-language / multi-currency.
- BI / data warehouse / analytics platform.

---

# 13. Hosting and Infrastructure

- **Backend:** AWS (App Runner or Elastic Beanstalk).
- **Database:** Supabase-managed PostgreSQL.
- **Redis:** Hosted Redis (AWS ElastiCache or similar).
- **CI/CD:** Jenkins.

---

# 14. Production Account Ownership

Production accounts (AWS, Supabase, Firebase, Razorpay, Cloudinary, Google Maps, Sentry, Redis, Jenkins) are **Client-owned**.

---

# 15. Environment and Secrets

The backend requires separate configuration for:

- Development, test/staging, production.

Secrets include:
- Firebase service account credentials.
- Supabase/PostgreSQL connection string.
- Razorpay key ID + secret.
- Cloudinary credentials.
- Google Maps API key.
- Sentry DSN.
- Redis connection string.
- JWT/session secrets if applicable.

**No secrets in source control.**

---

# 16. Antigravity Instruction

Read this document before beginning backend work. The backend is the authority. Do not create alternative authority in clients. Do not implement excluded features. Surface open decisions before inventing behavior.
