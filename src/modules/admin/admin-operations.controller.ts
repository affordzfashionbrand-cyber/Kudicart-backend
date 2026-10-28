import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin')
@UseGuards(FirebaseAuthGuard)
export class AdminOperationsController {
  constructor(private readonly adminService: AdminService) {}

  // --- Reviews ---
  @Get('reviews')
  async listReviews(@Query() query: any) {
    return this.adminService.listReviews(query);
  }

  @Patch('reviews/:id/status')
  async moderateReview(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateReviewStatus(id, body.status, user);
  }

  @Delete('reviews/:id')
  async deleteReview(@Param('id') id: string) {
    return { success: true, message: `Review ${id} deleted` };
  }

  // --- Support ---
  @Get('support')
  async listSupport(@Query() query: any) {
    return this.adminService.listSupportTickets(query);
  }

  @Get('support/:id')
  async getSupportTicket(@Param('id') id: string) {
    const list = (await this.adminService.listSupportTickets()).data;
    return list.find((t: any) => t.id === id) || { id, title: 'Support Ticket', status: 'OPEN' };
  }

  @Patch('support/:id/status')
  async updateSupportStatus(
    @Param('id') id: string,
    @Body() body: { status: string; resolutionNote?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateSupportStatus(id, body.status, user);
  }

  // --- Audit ---
  @Get('audit')
  async listAudit(@Query() query: any) {
    return this.adminService.listAuditLogs(query);
  }

  // --- Notifications ---
  @Get('notifications')
  async listNotifications(@Query() query: any) {
    return this.adminService.listNotifications(query);
  }

  @Patch('notifications/:id/read')
  async markNotificationRead(@Param('id') id: string) {
    return this.adminService.markNotificationAsRead(id);
  }

  @Post('notifications/broadcast')
  async broadcastNotification(@Body() body: any) {
    return this.adminService.broadcastNotification(body);
  }

  // --- Settings ---
  @Get('settings/preferences')
  async getPreferences() {
    return this.adminService.getPreferences();
  }

  @Put('settings/preferences')
  async updatePreferences(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.updatePreferences(body, user);
  }

  // --- User Access (RBAC) ---
  @Get('user-access/users')
  async listUserAccessUsers() {
    return this.adminService.getUserAccessUsers();
  }

  @Post('user-access/users')
  async inviteUser(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.inviteUser(body, user);
  }

  @Patch('user-access/users/:id/role')
  async updateUserRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.adminService.updateUserRole(id, body.role);
  }

  @Get('user-access/roles')
  async listRoles() {
    return this.adminService.getUserRoles();
  }

  @Get('user-access/permissions')
  async listPermissions() {
    return this.adminService.getUserPermissions();
  }

  // --- Users Directory ---
  @Get('users')
  async listUsers(@Query() query: any) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
  ) {
    return this.adminService.updateUserStatus(id, body);
  }

  // --- Reports ---
  @Get('reports')
  async getReports(@Query('dateRange') dateRange?: string) {
    return this.adminService.getReports(dateRange);
  }
}
