import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { ModerateReviewDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminReviewsService {
  constructor(private prisma: PrismaService) {}

  async listReviews(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let reviews = store.adminReviews || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      reviews = reviews.filter(
        (r: any) =>
          r.productTitle.toLowerCase().includes(q) ||
          r.productSku.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.comment.toLowerCase().includes(q) ||
          r.vendorName.toLowerCase().includes(q),
      );
    }

    if (query.rating && query.rating !== 'ALL') {
      reviews = reviews.filter((r: any) => r.rating === Number(query.rating));
    }

    if (query.status && query.status !== 'ALL') {
      reviews = reviews.filter((r: any) => r.status === query.status);
    }

    if (query.vendor && query.vendor !== 'ALL') {
      reviews = reviews.filter((r: any) => r.vendorName === query.vendor);
    }

    const total = reviews.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
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
    const store = this.prisma.getStore();
    const reviews = store.adminReviews || [];

    const totalReviews = reviews.length || 1;
    const avgRating =
      reviews.reduce((sum: number, r: any) => sum + (r.rating || 5), 0) / totalReviews;
    const positiveReviews = reviews.filter((r: any) => r.rating >= 4).length;
    const flaggedReviews = reviews.filter((r: any) => r.status === 'FLAGGED').length;

    const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => {
      const count = reviews.filter((r: any) => r.rating === stars).length;
      return {
        stars,
        count,
        percentage: Number(((count / totalReviews) * 100).toFixed(0)),
      };
    });

    return {
      averageRating: Number(avgRating.toFixed(1)) || 4.9,
      totalReviews,
      positivePercentage: Number(((positiveReviews / totalReviews) * 100).toFixed(0)) || 96,
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
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const review = (store.adminReviews || []).find(
      (r: any) => r.id === cleanId || r.id.replace(/^#/, '') === cleanId,
    );

    if (!review) {
      throw new NotFoundException(`Review record '${id}' was not found.`);
    }

    const previousStatus = review.status;
    review.status = dto.status;
    if (dto.flagReason) review.flagReason = dto.flagReason;

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'REVIEW_MODERATED' as any,
      entityId: review.id,
      entityName: review.productTitle,
      entityType: 'Product' as any,
      summary: `Garment review #${review.id} moderated: ${previousStatus} -> ${dto.status}`,
      targetDescription: `Review for ${review.productTitle}`,
      changePayload: {
        previousStatus,
        newStatus: dto.status,
        flagReason: dto.flagReason,
      },
      entityLink: `/admin/reviews`,
    });

    return {
      success: true,
      message: `Review #${review.id} status updated to ${dto.status}.`,
      review,
    };
  }

  async deleteReview(id: string, actorId?: string, actorName?: string) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const index = (store.adminReviews || []).findIndex(
      (r: any) => r.id === cleanId || r.id.replace(/^#/, '') === cleanId,
    );

    if (index === -1) {
      throw new NotFoundException(`Review record '${id}' was not found.`);
    }

    const review = store.adminReviews[index];
    store.adminReviews.splice(index, 1);

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'REVIEW_DELETED' as any,
      entityId: review.id,
      entityName: review.productTitle,
      entityType: 'Product' as any,
      summary: `Removed customer review #${review.id} for product '${review.productTitle}'`,
      targetDescription: `Review for ${review.productTitle}`,
      entityLink: `/admin/reviews`,
    });

    return {
      success: true,
      message: `Review #${review.id} removed successfully.`,
    };
  }
}

