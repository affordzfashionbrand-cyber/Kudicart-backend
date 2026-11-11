import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSupportTicketDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminSupportService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDb() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('Database connection unavailable');
    }
  }

  private formatTicket(t: any) {
    return {
      id: t.id,
      userId: t.userId,
      orderId: t.orderId,
      orderNumber: t.order?.orderNumber || '',
      customerName: t.user?.name || 'Customer',
      customerEmail: t.user?.email || '',
      customerPhone: t.user?.phone || '',
      subject: t.title,
      title: t.title,
      description: t.description || '',
      category: t.category,
      priority: t.priority || 'MEDIUM',
      status: t.status,
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
        order: true,
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
        order: true,
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
        order: true,
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
          order: true,
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

    return {
      success: true,
      message: `Support ticket #${updated.id} updated successfully.`,
      ticket: this.formatTicket(updated),
    };
  }
}

