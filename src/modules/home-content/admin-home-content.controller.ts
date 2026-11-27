import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HomeContentService } from './home-content.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateBankOfferDto } from './dto/create-bank-offer.dto';
import { UpdateBankOfferDto } from './dto/update-bank-offer.dto';
import {
  ReorderItemsDto,
  ReorderSectionsDto,
} from './dto/reorder-items.dto';
import { UpdateSectionConfigDto } from './dto/update-section-config.dto';
import {
  CreateSectionItemDto,
  UpdateSectionItemDto,
} from './dto/create-section-item.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/home')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminHomeContentController {
  constructor(private readonly homeContentService: HomeContentService) {}

  // =========================================================================
  // BANNERS MANAGEMENT
  // =========================================================================
  @Get('banners')
  async listBanners(
    @Query('placement') placement?: string,
    @Query('targetGender') targetGender?: string,
    @Query('isActive') isActive?: string,
    @Query('status') status?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    return this.homeContentService.listBanners({
      placement,
      targetGender,
      isActive,
      status,
      vendorId,
    });
  }

  @Patch('banners/reorder')
  async reorderBanners(
    @Body() dto: ReorderItemsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.reorderBanners(dto, actor?.id, actor?.name);
  }

  @Get('banners/:id')
  async getBannerById(@Param('id') id: string) {
    return this.homeContentService.getBannerById(id);
  }

  @Post('banners')
  @HttpCode(HttpStatus.CREATED)
  async createBanner(
    @Body() dto: CreateBannerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.createBanner(dto, actor?.id, actor?.name);
  }

  @Patch('banners/:id')
  async updateBanner(
    @Param('id') id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.updateBanner(id, dto, actor?.id, actor?.name);
  }

  @Delete('banners/:id')
  async deleteBanner(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.deleteBanner(id, actor?.id, actor?.name);
  }

  @Post('banners/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveBanner(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.approveBanner(id, actor?.id, actor?.name);
  }

  @Post('banners/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectBanner(
    @Param('id') id: string,
    @Body() body: { rejectionComment: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.rejectBanner(
      id,
      body?.rejectionComment,
      actor?.id,
      actor?.name,
    );
  }

  // =========================================================================
  // BANK OFFERS MANAGEMENT
  // =========================================================================
  @Get('bank-offers')
  async listBankOffers(@Query('isActive') isActive?: string) {
    return this.homeContentService.listBankOffers({ isActive });
  }

  @Patch('bank-offers/reorder')
  async reorderBankOffers(
    @Body() dto: ReorderItemsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.reorderBankOffers(
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Get('bank-offers/:id')
  async getBankOfferById(@Param('id') id: string) {
    return this.homeContentService.getBankOfferById(id);
  }

  @Post('bank-offers')
  @HttpCode(HttpStatus.CREATED)
  async createBankOffer(
    @Body() dto: CreateBankOfferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.createBankOffer(dto, actor?.id, actor?.name);
  }

  @Patch('bank-offers/:id')
  async updateBankOffer(
    @Param('id') id: string,
    @Body() dto: UpdateBankOfferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.updateBankOffer(
      id,
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Delete('bank-offers/:id')
  async deleteBankOffer(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.deleteBankOffer(id, actor?.id, actor?.name);
  }

  // =========================================================================
  // HOMEPAGE SECTIONS & CURATED ITEMS MANAGEMENT
  // =========================================================================
  @Get('sections')
  async listSections() {
    return this.homeContentService.listSections();
  }

  @Patch('sections/reorder')
  async reorderSections(
    @Body() dto: ReorderSectionsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.reorderSections(dto, actor?.id, actor?.name);
  }

  @Patch('sections/items/reorder')
  async reorderSectionItems(
    @Body() dto: ReorderItemsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.reorderSectionItems(
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Patch('sections/:sectionKey')
  async updateSectionConfig(
    @Param('sectionKey') sectionKey: string,
    @Body() dto: UpdateSectionConfigDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.updateSectionConfig(
      sectionKey,
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Post('sections/:sectionKey/items')
  @HttpCode(HttpStatus.CREATED)
  async addSectionItem(
    @Param('sectionKey') sectionKey: string,
    @Body() dto: CreateSectionItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.addSectionItem(
      sectionKey,
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Patch('sections/items/:itemId')
  async updateSectionItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSectionItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.updateSectionItem(
      itemId,
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Delete('sections/items/:itemId')
  async deleteSectionItem(
    @Param('itemId') itemId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.homeContentService.deleteSectionItem(
      itemId,
      actor?.id,
      actor?.name,
    );
  }
}
