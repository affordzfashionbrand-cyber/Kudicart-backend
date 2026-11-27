import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly bucket = 'product-images';
  private readonly supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  private readonly supabaseKey = (
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif',
    'application/pdf',
  ];

  private readonly allowedSupportVideoMimeTypes = [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp',
    'video/x-m4v',
  ];

  async uploadProductImage(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<{ url: string; path: string }> {
    return this.uploadMediaFile(file, {
      folder: 'products',
      allowVideos: false,
      maxBytes: 5 * 1024 * 1024,
    });
  }

  async uploadSupportAttachment(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<{ url: string; path: string; mimeType: string; mediaType: 'image' | 'video'; sizeBytes: number; name: string }> {
    const mime = (file?.mimetype || '').toLowerCase();
    const isVideo = this.allowedSupportVideoMimeTypes.includes(mime);
    const maxBytes = isVideo ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    const uploaded = await this.uploadMediaFile(file, {
      folder: 'support-attachments',
      allowVideos: true,
      maxBytes,
    });

    return {
      url: uploaded.url,
      path: uploaded.path,
      mimeType: mime,
      mediaType: isVideo ? 'video' : 'image',
      sizeBytes: file.size,
      name: file.originalname,
    };
  }

  async uploadMediaFile(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    options: { folder: string; allowVideos: boolean; maxBytes: number },
  ): Promise<{ url: string; path: string }> {
    if (!this.supabaseUrl || !this.supabaseKey) {
      throw new ServiceUnavailableException(
        'Supabase Storage is not configured (SUPABASE_URL and SUPABASE_KEY are required).',
      );
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('Media file buffer is required.');
    }

    const mime = (file.mimetype || '').toLowerCase();
    const allowedSet = options.allowVideos
      ? [...this.allowedMimeTypes, ...this.allowedSupportVideoMimeTypes]
      : this.allowedMimeTypes;

    if (!allowedSet.includes(mime)) {
      throw new BadRequestException(
        options.allowVideos
          ? `Invalid file type '${file.mimetype}'. Allowed formats: JPEG, PNG, WebP, PDF, MP4, MOV, WebM.`
          : `Invalid file type '${file.mimetype}'. Allowed formats: JPEG, PNG, WebP, AVIF, PDF.`,
      );
    }

    if (file.size > options.maxBytes) {
      const maxMb = Math.round(options.maxBytes / (1024 * 1024));
      throw new BadRequestException(
        `File size ${(file.size / (1024 * 1024)).toFixed(2)}MB exceeds maximum ${maxMb}MB limit.`,
      );
    }

    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const filePath = `${options.folder}/${uniqueId}-${cleanName}`;

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
        this.logger.error(
          `Supabase Storage upload failed (status ${response.status}): ${errorText}`,
        );
        throw new BadRequestException(
          `Media upload to storage provider failed: ${errorText || response.statusText}`,
        );
      }

      this.logger.log(`Successfully uploaded media file to Supabase Storage: ${filePath}`);

      return {
        url: publicUrl,
        path: filePath,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Supabase Storage network error: ${err.message}`);
      throw new BadRequestException(`Media storage service unavailable: ${err.message}`);
    }
  }
}
