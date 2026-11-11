import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';

function parseAuditDetails(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { details: raw };
  } catch {
    return { details: raw };
  }
}

function mapActorRoleLabel(role: string | null): string {
  switch ((role || '').toUpperCase()) {
    case 'ADMIN':
      return 'Admin';
    case 'SYSTEM':
      return 'System Automation';
    case 'FINANCE':
      return 'Finance Settlement';
    case 'VENDOR':
      return 'Vendor';
    case 'DRIVER':
      return 'Driver';
    case 'CUSTOMER':
      return 'Customer';
    default:
      return role || 'Admin';
  }
}

function mapEntityLink(entityType: string, entityId: string): string | undefined {
  switch (entityType.toUpperCase()) {
    case 'ORDER':
      return `/admin/orders/${entityId}`;
    case 'DRIVER':
    case 'DRIVERPROFILE':
      return `/admin/delivery-partners/${entityId}`;
    case 'VENDOR':
      return '/admin/vendors';
    case 'PRODUCT':
      return `/admin/products/${entityId}`;
    case 'PAYMENT':
    case 'PAYMENTTRANSACTION':
      return '/admin/payments';
    default:
      return undefined;
  }
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditEvents(query: AdminQueryDto) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    if (!this.prisma.isConnectedToDb) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
      };
    }

    const where: any = {};

    if (query.actionType && query.actionType !== 'ALL') {
      where.action = query.actionType;
    }

    if (query.actorRole && query.actorRole !== 'ALL') {
      const normalized =
        query.actorRole === 'Admin' || query.actorRole === 'Central Ops Lead'
          ? 'ADMIN'
          : query.actorRole === 'System Automation'
            ? 'SYSTEM'
            : query.actorRole;
      where.userRole = normalized;
    }

    if (query.entityType && query.entityType !== 'ALL') {
      where.entityType = { equals: query.entityType, mode: 'insensitive' };
    }

    if (query.dateRange) {
      const now = Date.now();
      const rangeMsMap: Record<string, number> = {
        TODAY: 24 * 60 * 60 * 1000,
        LAST_24_HOURS: 24 * 60 * 60 * 1000,
        LAST_7_DAYS: 7 * 24 * 60 * 60 * 1000,
        LAST_30_DAYS: 30 * 24 * 60 * 60 * 1000,
      };
      const delta = rangeMsMap[query.dateRange];
      if (delta) {
        where.createdAt = { gte: new Date(now - delta) };
      }
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { id: { contains: s, mode: 'insensitive' } },
        { userId: { contains: s, mode: 'insensitive' } },
        { userEmail: { contains: s, mode: 'insensitive' } },
        { action: { contains: s, mode: 'insensitive' } },
        { entityId: { contains: s, mode: 'insensitive' } },
        { entityType: { contains: s, mode: 'insensitive' } },
        { details: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const data = rows.map((row) => {
      const parsed = parseAuditDetails(row.details);
      const actorName = row.userEmail || row.userRole || 'Platform System';
      const initials = actorName
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join('') || 'SYS';

      const summaryParts = [
        row.action.replace(/_/g, ' '),
        parsed.toStatus ? `-> ${parsed.toStatus}` : '',
        parsed.reason || parsed.note || parsed.message || '',
      ].filter(Boolean);

      return {
        id: row.id,
        timestamp: row.createdAt.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        timestampFull: row.createdAt.toISOString(),
        actorId: row.userId || 'SYSTEM',
        actorName,
        actorRole: mapActorRoleLabel(row.userRole),
        actorInitials: initials,
        actionType: row.action,
        entityId: row.entityId,
        entityName: parsed.orderNumber || parsed.storeName || row.entityId,
        entityType: row.entityType,
        ipAddress: row.ipAddress || 'internal',
        gatewayVpn: 'API Gateway',
        userAgent: 'Affordz Backend',
        sessionTokenHash: 'verified-jwt',
        summary: summaryParts.join(' · '),
        targetDescription: `${row.entityType} #${row.entityId}`,
        changePayload: parsed,
        entityLink: mapEntityLink(row.entityType, row.entityId),
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
