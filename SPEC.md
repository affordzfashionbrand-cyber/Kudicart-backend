# KudiCart Backend — Product Specification

> **Purpose:** Define all approved product requirements for the KudiCart Backend API.
>
> The backend serves all four client applications. This specification covers the server-side requirements that must be fulfilled.

---

# 1. Product Goal

The KudiCart Backend is the single NestJS application that enforces all business rules, manages data persistence, handles authentication/authorization, integrates with external services, and exposes REST APIs consumed by Customer, Driver, Admin/Vendor applications.

---

# 2. Authentication Requirements

### R-AUTH-01 — Firebase Token Verification
The backend shall verify Firebase ID tokens for all authenticated requests.

### R-AUTH-02 — User/Role Resolution
The backend shall resolve Firebase UID to application user and role (Customer, Vendor, Admin, Delivery Partner).

### R-AUTH-03 — Role-Based Access Control
The backend shall enforce role-based access control on all protected endpoints.

### R-AUTH-04 — Customer Auth (Phone/OTP)
Support Firebase phone/OTP authenticated customers.

### R-AUTH-05 — Admin/Vendor Auth (Email/Password)
Support Firebase email/password authenticated admins and vendors.

### R-AUTH-06 — Delivery Partner Auth (Phone/OTP)
Support Firebase phone/OTP authenticated delivery partners.

---

# 3. User/Profile Requirements

### R-USER-01 — Customer Profile
Customer profile CRUD operations.

### R-USER-02 — Vendor Profile
Vendor profile management.

### R-USER-03 — Delivery Partner Profile
Delivery partner profile management including KYC status.

### R-USER-04 — Admin User Management
Admin can manage all user types.

---

# 4. Vendor Requirements

### R-VENDOR-01 — Vendor Management
Admin can create, view, update, and manage vendors.

### R-VENDOR-02 — Vendor Approval
Admin can approve/reject vendors.

### R-VENDOR-03 — Vendor Scope Isolation
All vendor-scoped data access must enforce vendor_id filtering. No cross-vendor data leakage.

### R-VENDOR-04 — Vendor Staff
Support vendor staff functionality as specified.

---

# 5. Catalog/Product Requirements

### R-CATALOG-01 — Category Management
Admin can manage categories (CRUD).

### R-CATALOG-02 — Product Management
Admin and Vendor can manage products within their permitted scope.

### R-CATALOG-03 — Product Pricing
Vendor can manage product pricing.

### R-CATALOG-04 — Stock Management
Vendor can manage product stock quantities.

### R-CATALOG-05 — Product Media
Product images managed through Cloudinary integration.

### R-CATALOG-06 — Catalog Browsing API
Customer can browse categories and products.

---

# 6. Cart and Address Requirements

### R-CART-01 — Cart Operations
Customer cart management (add, update, remove items).

### R-ADDR-01 — Address Management
Customer address CRUD operations.

---

# 7. Order Requirements

### R-ORDER-01 — Order Creation
Create orders from checkout (with payment verification where applicable).

### R-ORDER-02 — Order State Machine
Enforce the canonical order lifecycle:
```text
PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
→ ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

### R-ORDER-03 — Role-Gated Transitions
State transitions are restricted by actor role:
- Vendor: PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP
- Admin: READY_FOR_PICKUP → ASSIGNED
- Driver: ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED

### R-ORDER-04 — Order History
Customers can view their order history.

### R-ORDER-05 — Order Status History
Maintain order status change history for traceability.

### R-ORDER-06 — Admin Order Management
Admin can view and manage all orders.

### R-ORDER-07 — Vendor Order Management
Vendor can view and manage their own orders only.

---

# 8. Payment Requirements

### R-PAY-01 — Razorpay Integration
Server-side Razorpay order creation.

### R-PAY-02 — Payment Verification
Server-side Razorpay payment signature verification.

### R-PAY-03 — Payment Recording
Record verified payment state linked to order.

### R-PAY-04 — COD Support
Support Cash on Delivery payment method.

### R-PAY-05 — Payment Visibility
Admin can view payment records.

### R-PAY-06 — No Second Gateway
Only Razorpay. No second payment gateway.

---

# 9. Delivery Requirements

### R-DELIVERY-01 — Manual Assignment
Admin manually assigns delivery partner to order. NO automatic dispatch.

### R-DELIVERY-02 — Delivery Status Updates
Delivery partner updates delivery statuses (PICKED_UP, OUT_FOR_DELIVERY, DELIVERED).

### R-DELIVERY-03 — Delivery Partner Availability
Backend tracks delivery partner availability status.

### R-DELIVERY-04 — KYC Status
Backend manages delivery partner KYC information/status.

### R-DELIVERY-05 — No Auto Dispatch
The system shall NOT automatically select, match, or dispatch riders.

---

# 10. Notification Requirements

### R-NOTIF-01 — FCM Server-Side Dispatch
Send push notifications via Firebase Cloud Messaging.

### R-NOTIF-02 — Notification Events
Generate notifications for relevant business events (order status changes, assignments, etc.).

### R-NOTIF-03 — Notification Persistence
Persist notification records for in-app feed retrieval.

### R-NOTIF-04 — Device Token Management
Manage device FCM tokens per user.

---

# 11. Review Requirements

### R-REVIEW-01 — Review/Rating Submission
Accept customer reviews and ratings.

### R-REVIEW-02 — Review Visibility
Reviews visible to customers and manageable by admin.

---

# 12. Support Requirements

### R-SUPPORT-01 — Support Tickets
Customer can create support tickets. Admin can manage tickets.

---

# 13. Ledger/Commission Requirements

### R-LEDGER-01 — Commission Tracking
Track vendor commissions.

### R-LEDGER-02 — Earnings Recording
Record earnings and ledger entries.

### R-LEDGER-03 — Admin Visibility
Admin can view ledger/commission/earnings data.

---

# 14. Media Requirements

### R-MEDIA-01 — Cloudinary Integration
Upload, store, and serve media through Cloudinary.

### R-MEDIA-02 — Product Images
Product image upload and URL management.

---

# 15. Reporting Requirements

### R-REPORT-01 — Admin Reporting
Basic reporting and aggregations for admin dashboard.

### R-REPORT-02 — CSV Export
CSV export for approved datasets.

### R-REPORT-03 — Vendor Reporting
Vendor-scoped reporting.

---

# 16. Audit Requirements

### R-AUDIT-01 — Audit Logging
Record applicable write operations.

### R-AUDIT-02 — Actor Association
Associate audit events with the performing actor.

### R-AUDIT-03 — Admin Visibility
Admin can view audit records.

---

# 17. Infrastructure Requirements

### R-INFRA-01 — AWS Hosting
Backend hosted on AWS (App Runner or Elastic Beanstalk).

### R-INFRA-02 — Redis/BullMQ
Background job processing via BullMQ and Redis.

### R-INFRA-03 — Jenkins CI/CD
Jenkins for CI/CD pipelines.

### R-INFRA-04 — Sentry
Server-side Sentry error tracking.

### R-INFRA-05 — Environment Management
Separate development, staging, production configurations.

---

# 18. Quality Requirements

### R-QA-01 — Unit Tests
### R-QA-02 — Integration Tests
### R-QA-03 — API Tests
### R-QA-04 — Auth/Authorization Tests
### R-QA-05 — Payment Tests
### R-QA-06 — Order State Tests
### R-QA-07 — Vendor Isolation Tests

---

# 19. Hard Constraints

1. Single NestJS backend for all clients.
2. No business logic in client applications.
3. Razorpay is the only payment gateway.
4. Firebase is the only auth provider.
5. Manual rider assignment only.
6. No excluded features.

---

# 20. Open Questions

1. Exact actor profile fields.
2. Vendor staff model.
3. KYC fields/documents/statuses.
4. Detailed product attributes/variants/units/tax.
5. Multi-vendor cart behavior.
6. Checkout pricing composition.
7. Exact refund triggers/states.
8. Exact order transition permission matrix.
9. Exceptional/rejection order states.
10. Delivery tracking frequency/model.
11. Review eligibility rules.
12. Support ticket field/status/priority model.
13. Notification event catalog.
14. Commission formulas.
15. Dashboard definitions.
16. CSV datasets/columns.
17. Audit event catalog and retention.
18. ORM choice (TypeORM vs Prisma).

---

# 21. Acceptance Criteria (Backend)

- [ ] All authentication methods work (phone/OTP, email/password).
- [ ] RBAC enforces role-based access.
- [ ] Vendor isolation prevents cross-vendor access.
- [ ] Order state machine enforces valid transitions.
- [ ] Razorpay payment verification works.
- [ ] COD orders work.
- [ ] Manual assignment works, no auto-dispatch exists.
- [ ] FCM notifications dispatch correctly.
- [ ] Cloudinary media operations work.
- [ ] BullMQ background jobs execute.
- [ ] Audit logging captures write operations.
- [ ] CSV export generates correctly.
- [ ] No excluded functionality exists.
