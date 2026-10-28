import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';

@Controller('api/v1/admin/categories')
@UseGuards(FirebaseAuthGuard)
export class AdminCategoriesController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async listCategories(@Query() query: any) {
    return this.adminService.listCategories();
  }

  @Post()
  async createCategory(@Body() body: any) {
    return { success: true, category: { id: `cat-${Date.now()}`, ...body } };
  }

  @Put(':id')
  async updateCategory(@Param('id') id: string, @Body() body: any) {
    return { success: true, category: { id, ...body } };
  }

  @Delete(':id')
  async deleteCategory(@Param('id') id: string) {
    return { success: true, message: `Category ${id} deleted` };
  }
}
