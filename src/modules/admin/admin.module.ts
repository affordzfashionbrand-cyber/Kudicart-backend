import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminService } from './admin.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminAssignmentsController } from './admin-assignments.controller';
import { AdminVendorsController } from './admin-vendors.controller';
import { AdminDeliveryPartnersController } from './admin-delivery-partners.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminOperationsController } from './admin-operations.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminOrdersController,
    AdminAssignmentsController,
    AdminVendorsController,
    AdminDeliveryPartnersController,
    AdminProductsController,
    AdminCategoriesController,
    AdminFinanceController,
    AdminOperationsController,
  ],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
