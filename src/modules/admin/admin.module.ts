import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';

// Controllers
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminVendorsController } from './controllers/admin-vendors.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminProductsController } from './controllers/admin-products.controller';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { AdminDeliveryPartnersController } from './controllers/admin-delivery-partners.controller';
import { AdminAssignmentsController } from './controllers/admin-assignments.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminLedgerController } from './controllers/admin-ledger.controller';
import { AdminReviewsController } from './controllers/admin-reviews.controller';
import { AdminSupportController } from './controllers/admin-support.controller';
import { AdminUserAccessController } from './controllers/admin-user-access.controller';
import { AdminReportsController } from './controllers/admin-reports.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminNotificationsController } from './controllers/admin-notifications.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';

// Services
import { AdminAuthService } from './services/admin-auth.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminVendorsService } from './services/admin-vendors.service';
import { AdminCatalogService } from './services/admin-catalog.service';
import { AdminOrdersService } from './services/admin-orders.service';
import { AdminDriversService } from './services/admin-drivers.service';
import { AdminFinanceService } from './services/admin-finance.service';
import { AdminReviewsService } from './services/admin-reviews.service';
import { AdminSupportService } from './services/admin-support.service';
import { AdminAccessService } from './services/admin-access.service';
import { AdminReportsService } from './services/admin-reports.service';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminNotificationsService } from './services/admin-notifications.service';
import { AdminSettingsService } from './services/admin-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminUsersController,
    AdminVendorsController,
    AdminCategoriesController,
    AdminProductsController,
    AdminOrdersController,
    AdminDeliveryPartnersController,
    AdminAssignmentsController,
    AdminPaymentsController,
    AdminLedgerController,
    AdminReviewsController,
    AdminSupportController,
    AdminUserAccessController,
    AdminReportsController,
    AdminAuditController,
    AdminNotificationsController,
    AdminSettingsController,
  ],
  providers: [
    AdminAuthService,
    AdminDashboardService,
    AdminUsersService,
    AdminVendorsService,
    AdminCatalogService,
    AdminOrdersService,
    AdminDriversService,
    AdminFinanceService,
    AdminReviewsService,
    AdminSupportService,
    AdminAccessService,
    AdminReportsService,
    AdminAuditService,
    AdminNotificationsService,
    AdminSettingsService,
  ],
  exports: [
    AdminAuthService,
    AdminDashboardService,
    AdminUsersService,
    AdminVendorsService,
    AdminCatalogService,
    AdminOrdersService,
    AdminDriversService,
    AdminFinanceService,
    AdminReviewsService,
    AdminSupportService,
    AdminAccessService,
    AdminReportsService,
    AdminAuditService,
    AdminNotificationsService,
    AdminSettingsService,
  ],
})
export class AdminModule {}
