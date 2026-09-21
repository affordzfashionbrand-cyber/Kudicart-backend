# KudiCart Backend — Implementation Plan

> **Purpose:** Bounded execution plan for the KudiCart Backend.

---

# 1. Plan Status
**Status:** PRE-ARCHITECTURE PLAN

---

# 2. Dependency Order

```text
Final Architecture Approved
        ↓
Phase 1: Project Foundation (NestJS, DB, Redis, config)
        ↓
Phase 2: Auth Module (Firebase verification, RBAC, vendor scope)
        ↓
Phase 3: User/Profile Module (all actor profiles)
        ↓
Phase 4: Vendor Module (management, approval, scoping)
        ↓
Phase 5: Category Module (CRUD)
        ↓
Phase 6: Product/Catalog Module (CRUD, media, pricing, stock)
        ↓
Phase 7: Cart Module
        ↓
Phase 8: Address Module
        ↓
Phase 9: Order Module (creation, state machine, transitions)
        ↓
Phase 10: Payment Module (Razorpay, verification, COD)
        ↓
Phase 11: Delivery Module (manual assignment, status updates, tracking)
        ↓
Phase 12: Notification Module (FCM dispatch, persistence, BullMQ)
        ↓
Phase 13: Review Module
        ↓
Phase 14: Support Module
        ↓
Phase 15: Ledger/Commission Module
        ↓
Phase 16: Media Module (Cloudinary)
        ↓
Phase 17: Reporting/CSV Module
        ↓
Phase 18: Audit Module
        ↓
Phase 19: Sentry Integration
        ↓
Phase 20: Cross-Client Integration Testing
        ↓
Phase 21: Security/Permission Verification
        ↓
Phase 22: Deployment (AWS, CI/CD)
```

---

# 3. Phase 1 — Project Foundation
**Status:** [ ]
- [ ] NestJS project initialization.
- [ ] TypeScript configuration.
- [ ] Database connection (Supabase PostgreSQL).
- [ ] ORM setup (TypeORM or Prisma).
- [ ] Redis connection (BullMQ).
- [ ] Environment/config management.
- [ ] Global exception filter.
- [ ] Validation pipes.
- [ ] Logging setup.
- [ ] Health check endpoint.

---

# 4. Phase 2 — Authentication and Authorization
**Status:** [ ]
- [ ] Firebase Admin SDK setup.
- [ ] Auth guard (Firebase token verification).
- [ ] User/role resolution from database.
- [ ] RBAC guard.
- [ ] Vendor scope injection.
- [ ] Request context (user, role, vendor_id).

---

# 5. Phase 3 — User/Profile Module
**Status:** [ ]
- [ ] Customer profile entity + CRUD.
- [ ] Vendor profile entity + CRUD.
- [ ] Delivery partner profile entity + CRUD.
- [ ] Admin user management endpoints.

---

# 6. Phase 4 — Vendor Module
**Status:** [ ]
- [ ] Vendor entity.
- [ ] Vendor CRUD (admin).
- [ ] Vendor approval workflow.
- [ ] Vendor scope enforcement.
- [ ] Vendor staff (if specified).

---

# 7. Phase 5 — Category Module
**Status:** [ ]
- [ ] Category entity.
- [ ] Category CRUD (admin).
- [ ] Category listing (public).

---

# 8. Phase 6 — Product/Catalog Module
**Status:** [ ]
- [ ] Product entity (with relations).
- [ ] Product CRUD (admin + vendor-scoped).
- [ ] Pricing management.
- [ ] Stock management.
- [ ] Product image management (Cloudinary).
- [ ] Public catalog browsing API.
- [ ] Product detail API.

---

# 9. Phase 7 — Cart Module
**Status:** [ ]
- [ ] Cart entity.
- [ ] Add/update/remove cart items.
- [ ] Cart retrieval.

---

# 10. Phase 8 — Address Module
**Status:** [ ]
- [ ] Address entity.
- [ ] Address CRUD (customer-scoped).

---

# 11. Phase 9 — Order Module
**Status:** [ ]
- [ ] Order entity (with relations).
- [ ] Order creation from checkout.
- [ ] Order state machine implementation.
- [ ] Role-gated transitions.
- [ ] Order status history tracking.
- [ ] Order listing (customer, vendor-scoped, admin).
- [ ] Order detail endpoint.

---

# 12. Phase 10 — Payment Module
**Status:** [ ]
- [ ] Razorpay SDK integration.
- [ ] Create Razorpay order.
- [ ] Verify payment signature.
- [ ] Payment entity + recording.
- [ ] COD support.
- [ ] Payment listing (admin).

---

# 13. Phase 11 — Delivery Module
**Status:** [ ]
- [ ] Delivery assignment entity.
- [ ] Manual assignment endpoint (admin).
- [ ] Delivery status update endpoints (driver).
- [ ] Driver availability management.
- [ ] KYC entity/management.
- [ ] No automatic dispatch.

---

# 14. Phase 12 — Notification Module
**Status:** [ ]
- [ ] Notification entity.
- [ ] FCM dispatch service (Firebase Admin SDK).
- [ ] BullMQ notification queue.
- [ ] Notification worker.
- [ ] Business event → notification mapping.
- [ ] Device token management.
- [ ] In-app notification feed API.

---

# 15. Phase 13 — Review Module
**Status:** [ ]
- [ ] Review entity.
- [ ] Review submission (customer).
- [ ] Review listing (public + admin).

---

# 16. Phase 14 — Support Module
**Status:** [ ]
- [ ] Support ticket entity.
- [ ] Ticket creation (customer).
- [ ] Ticket management (admin).
- [ ] Ticket listing/detail.

---

# 17. Phase 15 — Ledger/Commission Module
**Status:** [ ]
- [ ] Ledger entry entity.
- [ ] Commission calculation on order completion.
- [ ] Admin visibility endpoints.

---

# 18. Phase 16 — Media Module
**Status:** [ ]
- [ ] Cloudinary SDK integration.
- [ ] Upload endpoint.
- [ ] URL management.
- [ ] Media deletion.

---

# 19. Phase 17 — Reporting/CSV Module
**Status:** [ ]
- [ ] Admin dashboard aggregation endpoints.
- [ ] CSV generation service.
- [ ] CSV download endpoints.
- [ ] Vendor-scoped reporting.

---

# 20. Phase 18 — Audit Module
**Status:** [ ]
- [ ] Audit entity.
- [ ] Audit interceptor/decorator.
- [ ] Audit event recording.
- [ ] Admin audit query endpoint.

---

# 21. Phase 19 — Sentry Integration
**Status:** [ ]
- [ ] Sentry SDK setup.
- [ ] Global exception filter integration.
- [ ] Environment configuration.

---

# 22. Phase 20 — Cross-Client Integration Testing
**Status:** [ ]
- [ ] Customer purchase flow (E2E).
- [ ] Vendor order handling flow.
- [ ] Admin dispatch flow.
- [ ] Driver delivery flow.
- [ ] Payment flows.
- [ ] Notification flows.

---

# 23. Phase 21 — Security Verification
**Status:** [ ]
- [ ] Unauthenticated access rejected.
- [ ] Customer data isolation.
- [ ] Vendor data isolation.
- [ ] Driver restrictions.
- [ ] Admin-only enforcement.
- [ ] Payment verification.
- [ ] Secret protection.

---

# 24. Phase 22 — Deployment
**Status:** [ ]
- [ ] AWS deployment configuration.
- [ ] Production environment setup.
- [ ] Redis production configuration.
- [ ] CI/CD pipeline (Jenkins).
- [ ] Production smoke tests.
- [ ] Database migration strategy.

---

# 25. Implementation Gate
Before any phase: confirm architecture, identify requirements, verify after completion.
