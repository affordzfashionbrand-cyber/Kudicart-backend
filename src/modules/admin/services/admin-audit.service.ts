import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';

@Injectable()
export class AdminAuditService {
  constructor(private prisma: PrismaService) {}

  async listAuditEvents(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let events = store.auditEvents || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      events = events.filter(
        (e: any) =>
          e.id.toLowerCase().includes(q) ||
          e.actorName.toLowerCase().includes(q) ||
          e.actorId.toLowerCase().includes(q) ||
          e.entityId.toLowerCase().includes(q) ||
          (e.entityName && e.entityName.toLowerCase().includes(q)) ||
          e.summary.toLowerCase().includes(q) ||
          e.actionType.toLowerCase().includes(q),
      );
    }

    if (query.actionType && query.actionType !== 'ALL') {
      events = events.filter((e: any) => e.actionType === query.actionType);
    }

    if (query.actorRole && query.actorRole !== 'ALL') {
      events = events.filter((e: any) => e.actorRole === query.actorRole);
    }

    if (query.entityType && query.entityType !== 'ALL') {
      events = events.filter((e: any) => e.entityType === query.entityType);
    }

    const total = events.length;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 8;
    const startIndex = (page - 1) * limit;
    const paginated = events.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

