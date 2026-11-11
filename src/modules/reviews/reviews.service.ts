import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

const ID_ALIASES: Record<string, string> = {
  '1': 'prod-1',
  '101': 'prod-2',
  '102': 'prod-1',
  '103': 'prod-3',
  '104': 'prod-5',
  '105': 'prod-6',
  '106': 'prod-4',
  '107': 'prod-10',
  '108': 'prod-7',
  '2': 'prod-5',
  '3': 'prod-9',
  '4': 'prod-6',
  '9': 'prod-4',
};

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private resolveProductId(productId: string): string {
    return ID_ALIASES[productId] || productId;
  }

  private async resolveCanonicalUserId(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userId }, { firebaseUid: userId }],
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Authenticated customer profile not found.');
    }

    return user.id;
  }

  private formatReview(review: any) {
    const authorName = review.user?.name || 'Verified Buyer';
    const authorAvatar = review.user?.avatar || null;
    const authorId = review.user?.id || review.userId;

    return {
      id: review.id,
      userId: review.userId,
      productId: review.productId,
      orderId: review.orderId,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      author: {
        id: authorId,
        name: authorName,
        avatar: authorAvatar,
      },
      user: {
        id: authorId,
        name: authorName,
        avatar: authorAvatar,
      },
    };
  }

  async createReview(userId: string, dto: CreateReviewDto) {
    this.ensureDbConnected();

    const canonicalUserId = await this.resolveCanonicalUserId(userId);
    const resolvedProductId = this.resolveProductId(dto.productId);

    const product = await this.prisma.product.findUnique({
      where: { id: resolvedProductId },
      select: { id: true, title: true },
    });

    if (!product) {
      throw new NotFoundException(`Product '${dto.productId}' not found.`);
    }

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: dto.orderId }, { orderNumber: dto.orderId }],
      },
      include: {
        items: true,
        tryAndBuySession: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order '${dto.orderId}' not found.`);
    }

    if (order.customerId !== canonicalUserId) {
      throw new ForbiddenException('You can only review products from your own orders.');
    }

    const matchingItems = order.items.filter(
      (item) => item.productId === product.id || item.productId === dto.productId,
    );

    if (matchingItems.length === 0) {
      throw new BadRequestException('This product was not purchased in the specified order.');
    }

    if (order.isTryAndBuy) {
      const session = order.tryAndBuySession;
      const hasKeptDecision = matchingItems.some(
        (item) =>
          item.tryAndBuyDecision === 'KEEP' ||
          (session?.keptItemIds || []).includes(item.id),
      );

      if (session) {
        const isSettled = session.stage === 'COMPLETED' || session.stage === 'SETTLED';
        if (!isSettled || !hasKeptDecision) {
          throw new BadRequestException(
            'Reviews for Try & Buy orders require a settled trial with the product kept.',
          );
        }
      } else {
        const isDeliveredWithoutReturn =
          order.status === 'DELIVERED' &&
          matchingItems.some((item) => item.tryAndBuyDecision !== 'RETURN');
        if (!isDeliveredWithoutReturn) {
          throw new BadRequestException(
            'Only delivered orders with kept items can be reviewed.',
          );
        }
      }
    } else if (order.status !== 'DELIVERED') {
      throw new BadRequestException('You can only review products after the order is DELIVERED.');
    }

    const duplicate = await this.prisma.review.findFirst({
      where: {
        userId: canonicalUserId,
        productId: product.id,
        orderId: order.id,
      },
    });

    if (duplicate) {
      throw new ConflictException('You have already submitted a review for this item on this order.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          id: `rev-${randomUUID().slice(0, 8)}`,
          userId: canonicalUserId,
          productId: product.id,
          orderId: order.id,
          rating: dto.rating,
          comment: dto.comment.trim(),
          status: 'PUBLISHED',
        },
        include: {
          user: {
            select: { id: true, name: true, avatar: true },
          },
        },
      });

      const stats = await tx.review.aggregate({
        where: { productId: product.id, status: 'PUBLISHED' },
        _avg: { rating: true },
        _count: { _all: true },
      });

      const nextRating =
        stats._avg.rating !== null ? Number(stats._avg.rating.toFixed(1)) : 4.5;

      await tx.product.update({
        where: { id: product.id },
        data: {
          rating: nextRating,
          reviewsCount: stats._count._all,
        },
      });

      return review;
    });

    return {
      success: true,
      review: this.formatReview(created),
    };
  }

  async getReviewsForProduct(productId: string) {
    this.ensureDbConnected();

    const resolvedProductId = this.resolveProductId(productId);
    const reviews = await this.prisma.review.findMany({
      where: {
        productId: resolvedProductId,
        status: 'PUBLISHED',
      },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reviews.map((review) => this.formatReview(review));
  }
}
