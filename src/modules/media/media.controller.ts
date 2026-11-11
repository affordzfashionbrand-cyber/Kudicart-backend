import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupabaseStorageService } from './supabase-storage.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller()
@UseGuards(FirebaseAuthGuard, RolesGuard)
export class MediaController {
  constructor(private readonly storageService: SupabaseStorageService) {}

  private async handleUpload(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
    size: number;
  }) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type '${file.mimetype}'. Allowed: JPEG, PNG, WEBP, PDF.`,
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File size exceeds maximum 5MB limit.');
    }

    const result = await this.storageService.uploadProductImage(file);
    return {
      success: true,
      url: result.url,
      path: result.path,
    };
  }

  @Post('api/v1/admin/media/upload')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAdminImage(
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      mimetype: string;
      size: number;
    },
  ) {
    return this.handleUpload(file);
  }

  @Post('api/v1/media/upload')
  @Roles(Role.ADMIN, Role.VENDOR, Role.DRIVER)
  @UseInterceptors(FileInterceptor('file'))
  async uploadOperationalProof(
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      mimetype: string;
      size: number;
    },
  ) {
    return this.handleUpload(file);
  }
}
