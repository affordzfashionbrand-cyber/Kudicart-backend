# KudiCart Backend — Decisions

> **Purpose:** Record decisions approved for the Backend repository.

---

# 1. Technology Decisions

## D-BE-01 — Framework
**Status:** `LOCKED`
**NestJS** with **TypeScript**.

## D-BE-02 — Database
**Status:** `LOCKED`
**PostgreSQL** managed by **Supabase**.

## D-BE-03 — Authentication Provider
**Status:** `LOCKED`
**Firebase Authentication** — backend verifies Firebase ID tokens using **Firebase Admin SDK**. No second auth system.

## D-BE-04 — Payment Gateway
**Status:** `LOCKED`
**Razorpay** — single payment gateway. Server-side verification. No second gateway.

## D-BE-05 — Push Notifications
**Status:** `LOCKED`
**Firebase Cloud Messaging (FCM)** via Firebase Admin SDK.

## D-BE-06 — Media Storage
**Status:** `LOCKED`
**Cloudinary** for media upload, processing, and CDN.

## D-BE-07 — Maps Provider
**Status:** `LOCKED`
**Google Maps Platform** for geocoding and directions where needed server-side.

## D-BE-08 — Background Jobs
**Status:** `LOCKED`
**BullMQ** with **Redis** for background job processing.

## D-BE-09 — Error Tracking
**Status:** `LOCKED`
**Sentry** for server-side error tracking.

## D-BE-10 — Hosting
**Status:** `LOCKED`
**AWS** (App Runner or Elastic Beanstalk).

## D-BE-11 — CI/CD
**Status:** `LOCKED`
**Jenkins**.

## D-BE-12 — ORM
**Status:** `OPEN`
TypeORM or Prisma — to be decided during architecture.

---

# 2. Architecture Decisions

## D-BE-13 — Single Backend
**Status:** `LOCKED`
One NestJS backend serves all four clients. No separate backends per actor.

## D-BE-14 — Business Authority
**Status:** `LOCKED`
The backend is the single authority for business rules, data validation, authorization, and state management. Clients are presentation layers.

## D-BE-15 — Order State Machine
**Status:** `LOCKED`
Backend enforces the canonical order lifecycle with role-gated transitions.

## D-BE-16 — Manual Assignment Only
**Status:** `LOCKED`
Delivery partner assignment is manual/admin-driven. No automatic dispatch.

## D-BE-17 — Vendor Isolation
**Status:** `LOCKED`
All vendor-scoped queries must enforce vendor_id. Cross-vendor access is a security violation.

## D-BE-18 — Payment Verification
**Status:** `LOCKED`
All payments verified server-side with Razorpay. Client-side payment success is never trusted.

---

# 3. Scope Decisions

## D-BE-19 — Excluded Services
**Status:** `LOCKED`
Do NOT implement:
- Coupon service.
- Combo/bundle service.
- Delivery zone / serviceability service.
- Automatic rider dispatch / matching service.
- Route optimization service.
- AI recommendation service.
- Loyalty / referral / wallet service.
- Subscription service.
- Advanced inventory / warehouse service.
- Live chat service.
- Multi-language / multi-currency service.
- BI / data warehouse / analytics service.

## D-BE-20 — Reporting Boundary
**Status:** `LOCKED`
Admin dashboard cards, basic aggregations, CSV export. No BI platform, no Power BI/Tableau integration, no predictive analytics.

---

# 4. Account Ownership

## D-BE-21 — Production Accounts
**Status:** `LOCKED`
All production accounts (AWS, Supabase, Firebase, Razorpay, Cloudinary, Google Maps, Sentry, Redis, Jenkins) are **Client-owned**.

---

# 5. Open Decisions

| ID | Decision still required |
|---|---|
| O-BE-01 | ORM choice (TypeORM vs Prisma) |
| O-BE-02 | Exact profile fields (all actors) |
| O-BE-03 | Vendor staff model |
| O-BE-04 | KYC fields/documents/statuses |
| O-BE-05 | Product attributes/variants/units/tax |
| O-BE-06 | Multi-vendor cart behavior |
| O-BE-07 | Checkout pricing composition |
| O-BE-08 | Refund triggers/states |
| O-BE-09 | Order transition permission matrix |
| O-BE-10 | Exceptional order states |
| O-BE-11 | Delivery tracking model |
| O-BE-12 | Review eligibility rules |
| O-BE-13 | Support ticket model |
| O-BE-14 | Notification event catalog |
| O-BE-15 | Commission formulas |
| O-BE-16 | Dashboard definitions |
| O-BE-17 | CSV export definitions |
| O-BE-18 | Audit event catalog and retention |
| O-BE-19 | AWS hosting: App Runner vs Elastic Beanstalk |

---

# 6. Decision Precedence
1. Master `KudiCart_decisions.md`
2. This file's locked decisions
3. Approved specification
4. Design/plan
5. Prototype
6. AI assumptions
