import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async createReview(userId: string, dto: CreateReviewDto) {
    const store = this.prisma.getStore();

    // 1. Verify Product
    const product = store.products.find((p) => p.id === dto.productId);
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }

    // 2. Verify Order & Delivery Status (Review eligibility rule: order must be delivered to customer)
    const order = store.orders.find((o) => o.id === dto.orderId || o.orderNumber === dto.orderId);
    if (!order) {
      throw new NotFoundException(`Order ${dto.orderId} not found`);
    }

    if (order.customerId !== userId) {
      throw new ForbiddenException('You can only review products from your own orders');
    }

    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('You can only review items after the order is delivered');
    }

    const hasItem = order.items.some((i) => i.productId === dto.productId);
    if (!hasItem) {
      throw new BadRequestException('This product was not part of the specified order');
    }

    // 3. Create Review
    const newReview = {
      id: `rev-${Date.now()}`,
      userId,
      productId: dto.productId,
      orderId: order.id,
      rating: dto.rating,
      comment: dto.comment,
      createdAt: new Date().toISOString(),
    };

    store.reviews.push(newReview);

    // 4. Update Product average rating
    const productReviews = store.reviews.filter((r) => r.productId === dto.productId);
    const avgRating =
      productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length;

    product.rating = Number(avgRating.toFixed(1));
    product.reviewsCount = productReviews.length;

    return {
      success: true,
      message: 'Review submitted successfully',
      review: newReview,
    };
  }

  async getReviewsForProduct(productId: string) {
    const store = this.prisma.getStore();
    const reviews = store.reviews.filter((r) => r.productId === productId);

    return reviews.map((r) => {
      const user = store.users.find((u) => u.id === r.userId);
      return {
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        author: {
          name: user?.name || 'Verified Customer',
          avatar: user?.avatar,
        },
      };
    });
  }
}
