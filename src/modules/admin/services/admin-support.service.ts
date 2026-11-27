import {
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSupportTicketDto } from '../dto/admin-domain.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { Role } from '../../../common/enums/role.enum';

function formatTimeAgo(dateValue?: Date | string | null): string {
  if (!dateValue) return 'Just now';
  const ts = dateValue instanceof Date ? dateValue.getTime() : new Date(dateValue).getTime();
  if (!Number.isFinite(ts)) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

@Injectable()
export class AdminSupportService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private formatTicket(t: any) {
    const orderItems = Array.isArray(t.order?.items) ? t.order.items : [];
    const orderProductSummary =
      orderItems.length > 0
        ? orderItems
            .map((it: any) => `${it.quantity || 1}x ${it.title || 'Item'}`)
            .join(', ')
        : t.order?.orderNumber
          ? `Order #${t.order.orderNumber}`
          : 'General Support Inquiry';
    const addr = (t.order?.deliveryAddress as any) || t.order?.address || null;
    const locationParts = [addr?.locality, addr?.city].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(', ') : 'Customer Account';

    return {
      id: t.id,
      userId: t.userId,
      orderId: t.orderId,
      orderNumber: t.order?.orderNumber || '',
      orderAmount: Number(t.order?.grandTotal || 0),
      orderDeliveryStatus: t.order?.status || 'N/A',
      orderProductSummary,
      location,
      timeAgo: formatTimeAgo(t.createdAt),
      customerName: t.user?.name || 'Customer',
      customerEmail: t.user?.email || '',
      customerPhone: t.user?.phone || '',
      customerTier: 'Verified Customer',
      subject: t.title,
      title: t.title,
      description: t.description || '',
      category: t.category,
      priority: t.priority || 'MEDIUM',
      status: t.status,
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
      assignee: t.assignee || 'Unassigned',
      resolutionRemarks: t.resolutionRemarks || null,
      resolutionNote: t.resolutionRemarks || null,
      resolvedAt: t.resolvedAt ? new Date(t.resolvedAt).toISOString() : null,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
      updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
    };
  }

  async listTickets(query: AdminQueryDto) {
    this.ensureDb();

    const rows = await this.prisma.supportTicket.findMany({
      include: {
        user: true,
        order: {
          include: {
            items: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let tickets = rows.map((t) => this.formatTicket(t));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      tickets = tickets.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          t.customerEmail.toLowerCase().includes(q) ||
          t.orderNumber.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      tickets = tickets.filter((t) => t.status === query.status);
    }

    if (query.category && query.category !== 'ALL') {
      tickets = tickets.filter((t) => t.category === query.category);
    }

    if (query.priority && query.priority !== 'ALL') {
      tickets = tickets.filter((t) => t.priority === query.priority);
    }

    if (query.assignee && query.assignee !== 'ALL') {
      if (query.assignee === 'UNASSIGNED') {
        tickets = tickets.filter((t) => t.assignee.toLowerCase() === 'unassigned');
      } else {
        tickets = tickets.filter((t) =>
          t.assignee.toLowerCase().includes(query.assignee!.toLowerCase()),
        );
      }
    }

    return {
      data: tickets,
      total: tickets.length,
      counts: {
        all: tickets.length,
        open: tickets.filter((t) => t.status === 'OPEN').length,
        inProgress: tickets.filter((t) => t.status === 'IN_PROGRESS').length,
        resolved: tickets.filter((t) => t.status === 'RESOLVED').length,
        closed: tickets.filter((t) => t.status === 'CLOSED').length,
      },
    };
  }

  async getTicketById(id: string) {
    this.ensureDb();

    const cleanId = id.trim().replace(/^#/, '');
    const ticket = await this.prisma.supportTicket.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }],
      },
      include: {
        user: true,
        order: {
          include: {
            items: true,
            address: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Support ticket '${id}' was not found.`);
    }

    return this.formatTicket(ticket);
  }

  async updateTicket(
    id: string,
    dto: UpdateSupportTicketDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDb();

    const cleanId = id.trim().replace(/^#/, '');
    const existing = await this.prisma.supportTicket.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }],
      },
      include: {
        user: true,
        order: {
          include: {
            items: true,
            address: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Support ticket '${id}' was not found.`);
    }

    const previousStatus = existing.status;
    const remarks =
      dto.resolutionRemarks !== undefined
        ? dto.resolutionRemarks
        : dto.resolutionNote !== undefined
          ? dto.resolutionNote
          : undefined;
    const nextStatus = dto.status || existing.status;
    const shouldResolve = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supportTicket.update({
        where: { id: existing.id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.assignee !== undefined ? { assignee: dto.assignee } : {}),
          ...(remarks !== undefined ? { resolutionRemarks: remarks } : {}),
          ...(dto.status && shouldResolve && !existing.resolvedAt
            ? { resolvedAt: new Date() }
            : {}),
        },
        include: {
          user: true,
          order: {
            include: {
              items: true,
              address: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId || 'ADMIN',
          userEmail: actorName || null,
          userRole: 'ADMIN',
          action: 'SUPPORT_TICKET_UPDATED',
          entityType: 'SupportTicket',
          entityId: existing.id,
          details: JSON.stringify({
            previousStatus,
            newStatus: row.status,
            assignee: row.assignee,
            resolutionRemarks: row.resolutionRemarks,
            subject: existing.title,
          }),
        },
      });

      return row;
    });

    if (this.notificationsService && updated.userId) {
      const statusLabel = updated.status.replace(/_/g, ' ');
      const bodyText = updated.resolutionRemarks
        ? `Support update (${statusLabel}): ${updated.resolutionRemarks}`
        : `Your support ticket #${updated.id} is now ${statusLabel}.`;
      void this.notificationsService
        .sendNotification({
          recipientUserId: updated.userId,
          recipientRole: Role.CUSTOMER,
          category: 'ALERT',
          title: `Concierge Update • #${updated.id}`,
          body: bodyText,
          data: {
            ticketId: updated.id,
            ...(updated.orderId ? { orderId: updated.orderId } : {}),
            route: '/support',
          },
        })
        .catch(() => {});
    }

    return {
      success: true,
      message: `Support ticket #${updated.id} updated successfully.`,
      ticket: this.formatTicket(updated),
    };
  }
}

