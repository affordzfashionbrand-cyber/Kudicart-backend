# KudiCart Backend — System Design

> **Purpose:** System design for the KudiCart Common Backend.

---

# 1. Design Objectives

1. Serve all four clients through a unified REST API.
2. Be the single authority for business rules and data.
3. Enforce RBAC and vendor isolation.
4. Manage the order state machine.
5. Handle payment verification server-side.
6. Dispatch notifications via FCM.
7. Manage media via Cloudinary.
8. Process background jobs via BullMQ.
9. Record audit events.
10. Stay within approved scope.

---

# 2. High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│           KudiCart NestJS Backend              │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Auth     │  │  Users   │  │ Vendors  │    │
│  │  Module   │  │  Module  │  │  Module  │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Categories│  │ Products │  │   Cart   │    │
│  │  Module   │  │  Module  │  │  Module  │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Orders  │  │ Payments │  │ Delivery │    │
│  │  Module  │  │  Module  │  │  Module  │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Notifs   │  │ Reviews  │  │ Support  │    │
│  │  Module  │  │  Module  │  │  Module  │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Ledger  │  │  Media   │  │  Audit   │    │
│  │  Module  │  │  Module  │  │  Module  │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                                │
│  ┌──────────┐  ┌──────────┐                   │
│  │ Reports  │  │  Common  │                   │
│  │  Module  │  │ (Guards, │                   │
│  └──────────┘  │ Pipes,   │                   │
│                │ Filters) │                   │
│                └──────────┘                   │
└──────────────────────────────────────────────┘
           │           │           │
           ▼           ▼           ▼
      PostgreSQL    Redis     External Services
      (Supabase)   (BullMQ)   (Firebase, Razorpay,
                               Cloudinary, Maps,
                               Sentry)
```

---

# 3. Authentication Design

```text
Client sends request with Firebase ID Token (Authorization header)
        ↓
Auth Guard intercepts request
        ↓
Firebase Admin SDK verifies token
        ↓
Extract Firebase UID
        ↓
Resolve application user from database
        ↓
Attach user + role to request context
        ↓
RBAC Guard checks role permission for endpoint
        ↓
If Vendor role → attach vendor_id scope
        ↓
Request proceeds to controller
```

---

# 4. Authorization Design (RBAC)

```text
@Roles(Role.ADMIN)           → Admin only
@Roles(Role.VENDOR)          → Vendor only (with scope)
@Roles(Role.CUSTOMER)        → Customer only
@Roles(Role.DELIVERY_PARTNER)→ Delivery partner only
@Roles(Role.ADMIN, Role.VENDOR) → Admin or Vendor
```

Authorization is enforced at the controller/endpoint level via guards.

---

# 5. Vendor Scope Isolation Design

```text
Vendor request arrives
        ↓
Auth resolves vendor_id
        ↓
Service layer receives vendor_id
        ↓
Repository/query adds WHERE vendor_id = :vendorId
        ↓
All reads/writes scoped to that vendor
```

This is NOT optional. Every vendor data access path must enforce scope.

---

# 6. Order State Machine Design

```text
PLACED ──[Vendor accepts]──→ ACCEPTED
ACCEPTED ──[Vendor prepares]──→ PREPARING
PREPARING ──[Vendor ready]──→ READY_FOR_PICKUP
READY_FOR_PICKUP ──[Admin assigns rider]──→ ASSIGNED
ASSIGNED ──[Driver picks up]──→ PICKED_UP
PICKED_UP ──[Driver in transit]──→ OUT_FOR_DELIVERY
OUT_FOR_DELIVERY ──[Driver delivers]──→ DELIVERED
```

Each transition:
1. Validates current state.
2. Validates actor role/permission.
3. Records state change in history.
4. Triggers relevant business events (notification, ledger, etc.).

---

# 7. Payment Design

## Razorpay Flow
```text
Client requests order creation
        ↓
Backend creates Razorpay order (server-side)
        ↓
Returns order_id to client
        ↓
Client opens Razorpay SDK, customer pays
        ↓
Client sends payment details to backend
        ↓
Backend verifies signature with Razorpay server-side
        ↓
If verified → record payment → create/confirm order
If failed → reject → return error
```

## COD Flow
```text
Client requests order with COD payment method
        ↓
Backend creates order with payment_method = COD
        ↓
Payment collected on delivery (tracked manually)
```

---

# 8. Notification Design

```text
Business event occurs (order status change, assignment, etc.)
        ↓
Notification service creates notification record
        ↓
Notification record persisted to database (for in-app feed)
        ↓
FCM dispatch job queued via BullMQ
        ↓
BullMQ worker sends push via Firebase Admin SDK
        ↓
Device receives push notification
```

---

# 9. Media Design

```text
Client uploads file to backend endpoint
        ↓
Backend uploads to Cloudinary
        ↓
Cloudinary returns URL(s)
        ↓
Backend stores URL in database (linked to entity)
        ↓
Client receives URL for display
```

---

# 10. Ledger/Commission Design

```text
Order reaches DELIVERED state
        ↓
Backend calculates commission (formula TBD)
        ↓
Creates ledger entry:
  - Vendor earnings
  - Platform commission
  - Delivery partner earnings (if applicable)
        ↓
Admin can view ledger summary and details
```

---

# 11. Audit Design

```text
Write operation occurs (create, update, delete, status change)
        ↓
Audit interceptor/decorator captures:
  - Actor (user_id, role)
  - Action (what was done)
  - Entity (what was affected)
  - Timestamp
        ↓
Audit record persisted (sync or via BullMQ)
        ↓
Admin can query audit records
```

---

# 12. Background Job Design

```text
BullMQ Queues:
  ├── notification-queue → FCM dispatch
  ├── audit-queue → Audit record persistence (if async)
  ├── report-queue → CSV generation
  └── media-queue → Cloudinary operations (if async)

Redis ← BullMQ ← Workers process jobs
```

---

# 13. Error Handling Design

```text
Controller layer
  ↓ catches domain/validation errors
  ↓ transforms to HTTP response (400, 401, 403, 404, 409, 500)

Global exception filter
  ↓ catches unhandled errors
  ↓ logs to Sentry
  ↓ returns generic 500 response

Validation pipe
  ↓ validates DTOs
  ↓ returns 400 with field-level errors
```

---

# 14. Data Responsibility

```text
Client → API → Controller → Service → Repository → Database
         ↑                    ↑
    Validation            Business Rules
    (DTO/Pipe)           (Domain Logic)
```

Business rules live in the service layer, NOT in controllers, NOT in clients.

---

# 15. Scope Protection

The backend must NOT implement services for:
- Coupons, combos, loyalty, wallet, subscriptions.
- Automatic dispatch, delivery zones, route optimization.
- AI recommendations, BI platform, predictive analytics.
- Live chat, multi-language, multi-currency.

---

# 16. Antigravity Instructions

Before implementing a backend feature:
1. Read this design and the backend specification.
2. Identify the domain module it belongs to.
3. Confirm the feature is not excluded.
4. Maintain vendor isolation in all vendor-scoped operations.
5. Maintain order state machine discipline.
6. Verify payments server-side, never trust clients.
7. Do not invent business rules for open decisions.
