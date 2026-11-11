import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { ModerateReviewDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private formatReview(r: any) {
    return {
      id: r.id,
      userId: r.userId,
      productId: r.productId,
      orderId: r.orderId,
      productTitle: r.product?.title || 'Product',
      productSku: r.product?.sku || `SKU-${String(r.productId).toUpperCase()}`,
      customerName: r.user?.name || 'Customer',
      customerEmail: r.user?.email || '',
      vendorName: r.product?.vendor?.storeName || 'Affordz Official Store',
      rating: r.rating,
      comment: r.comment,
      status: r.status,
      flagReason: r.flagReason || null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    };
  }

  private async syncProductRating(tx: any, productId: string) {
    const published = await tx.review.findMany({
      where: { productId, status: 'PUBLISHED' },
      select: { rating: true },
    });
    const reviewsCount = published.length;
    const avg =
      reviewsCount > 0
        ? Number((published.reduce((sum: number, item: any) => sum + item.rating, 0) / reviewsCount).toFixed(1))
        : 0;
    await tx.product.update({
      where: { id: productId },
      data: { rating: avg, reviewsCount },
    });
  }

  async listReviews(query: AdminQueryDto) {
    this.ensureDb();

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);

    const rows = await this.prisma.review.findMany({
      include: {
        user: true,
        product: { include: { vendor: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let reviews = rows.map((r) => this.formatReview(r));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      reviews = reviews.filter(
        (r) =>
          r.productTitle.toLowerCase().includes(q) ||
          r.productSku.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.comment.toLowerCase().includes(q) ||
          r.vendorName.toLowerCase().includes(q),
      );
    }

    if (query.rating && query.rating !== 'ALL') {
      reviews = reviews.filter((r) => r.rating === Number(query.rating));
    }

    if (query.status && query.status !== 'ALL') {
      reviews = reviews.filter((r) => r.status === query.status);
    }

    if (query.vendor && query.vendor !== 'ALL') {
      reviews = reviews.filter((r) => r.vendorName === query.vendor);
    }

    const total = reviews.length;
    const startIndex = (page - 1) * limit;
    const paginated = reviews.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getReviewMetrics() {
    this.ensureDb();

    const reviews = await this.prisma.review.findMany({
      select: { rating: true, status: true },
    });

    const totalReviews = reviews.length;
    const denom = totalReviews || 1;
    const avgRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 5), 0) / denom
        : 0;
    const positiveReviews = reviews.filter((r) => r.rating >= 4).length;
    const flaggedReviews = reviews.filter((r) => r.status === 'FLAGGED').length;

    const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => {
      const count = reviews.filter((r) => r.rating === stars).length;
      return {
        stars,
        count,
        percentage: totalReviews > 0 ? Number(((count / denom) * 100).toFixed(0)) : 0,
      };
    });

    return {
      averageRating: Number(avgRating.toFixed(1)),
      totalReviews,
      positivePercentage:
        totalReviews > 0 ? Number(((positiveReviews / denom) * 100).toFixed(0)) : 0,
      ratingDistribution,
      flaggedCount: flaggedReviews,
    };
  }

  async moderateReview(
    id: string,
    dto: ModerateReviewDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const cleanId = id.trim().replace(/^#/, '');
    const existing = await this.prisma.review.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }],
      },
      include: {
        user: true,
        product: { include: { vendor: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Review record '${id}' was not found.`);
    }

    const previousStatus = existing.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.review.update({
        where: { id: existing.id },
        data: {
          status: dto.status,
          ...(dto.flagReason !== undefined ? { flagReason: dto.flagReason } : {}),
        },
        include: {
          user: true,
          product: { include: { vendor: true } },
        },
      });
      await this.syncProductRating(tx, existing.productId);
      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'REVIEW_MODERATED',
          entityType: 'Review',
          entityId: existing.id,
          details: JSON.stringify({
            previousStatus,
            newStatus: dto.status,
            flagReason: dto.flagReason,
            productTitle: existing.product?.title,
          }),
        },
      });
      return row;
    });

    const formatted = this.formatReview(updated);
    return {
      success: true,
      message: `Review #${updated.id} status updated to ${dto.status}.`,
      review: formatted,
    };
  }

  async deleteReview(id: string, actorId?: string, actorName?: string) {
    this.ensureDb();

    const cleanId = id.trim().replace(/^#/, '');
    const existing = await this.prisma.review.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }],
      },
      include: { product: true },
    });

    if (!existing) {
      throw new NotFoundException(`Review record '${id}' was not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: existing.id } });
      await this.syncProductRating(tx, existing.productId);
      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'REVIEW_DELETED',
          entityType: 'Review',
          entityId: existing.id,
          details: JSON.stringify({
            productId: existing.productId,
            productTitle: existing.product?.title,
          }),
        },
      });
    });

    return {
      success: true,
      message: `Review #${existing.id} removed successfully.`,
    };
  }
}

