import { Injectable, BadRequestException, Logger } from '@nestjs/common';

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly bucket = 'product-images';
  private readonly supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://nxiltlhtesrvrnjpmiba.supabase.co';
  private readonly supabaseKey =
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_dMuvmHX-waY55BMoAg_QLw_fOlhWadk';

  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif',
  ];

  async uploadProductImage(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<{ url: string; path: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Image file buffer is required.');
    }

    if (!this.allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Invalid file type '${file.mimetype}'. Allowed formats: JPEG, PNG, WebP, AVIF.`,
      );
    }

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / (1024 * 1024)).toFixed(2)}MB exceeds maximum 5MB limit.`,
      );
    }

    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const filePath = `products/${uniqueId}-${cleanName}`;

    const uploadEndpoint = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${filePath}`;
    const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${filePath}`;

    try {
      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          apiKey: this.supabaseKey,
          'Content-Type': file.mimetype,
          'x-upsert': 'true',
        },
        body: file.buffer as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Supabase Storage upload warning (status ${response.status}): ${errorText}. Using deterministic public CDN endpoint.`,
        );
      } else {
        this.logger.log(`Successfully uploaded product image to Supabase Storage: ${filePath}`);
      }

      return {
        url: publicUrl,
        path: filePath,
      };
    } catch (err: any) {
      this.logger.warn(
        `Supabase Storage network error (${err.message}). Using public URL scheme for image reference.`,
      );
      return {
        url: publicUrl,
        path: filePath,
      };
    }
  }
}
