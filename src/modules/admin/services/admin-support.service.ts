import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { UpdateSupportTicketDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminSupportService {
  constructor(private prisma: PrismaService) {}

  async listTickets(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let tickets = store.adminSupportTickets || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      tickets = tickets.filter(
        (t: any) =>
          t.id.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          t.customerEmail.toLowerCase().includes(q) ||
          t.orderNumber.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );
    }

    if (query.status && query.status !== 'ALL') {
      tickets = tickets.filter((t: any) => t.status === query.status);
    }

    if (query.category && query.category !== 'ALL') {
      tickets = tickets.filter((t: any) => t.category === query.category);
    }

    if (query.priority && query.priority !== 'ALL') {
      tickets = tickets.filter((t: any) => t.priority === query.priority);
    }

    if (query.assignee && query.assignee !== 'ALL') {
      if (query.assignee === 'UNASSIGNED') {
        tickets = tickets.filter((t: any) => t.assignee.toLowerCase() === 'unassigned');
      } else {
        tickets = tickets.filter((t: any) => t.assignee.toLowerCase().includes(query.assignee!.toLowerCase()));
      }
    }

    return {
      data: tickets,
      total: tickets.length,
      counts: {
        all: tickets.length,
        open: tickets.filter((t: any) => t.status === 'OPEN').length,
        inProgress: tickets.filter((t: any) => t.status === 'IN_PROGRESS').length,
        resolved: tickets.filter((t: any) => t.status === 'RESOLVED').length,
      },
    };
  }

  async getTicketById(id: string) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const ticket = (store.adminSupportTickets || []).find(
      (t: any) => t.id === cleanId || t.id.replace(/^#/, '') === cleanId,
    );

    if (!ticket) {
      throw new NotFoundException(`Support ticket '${id}' was not found.`);
    }

    return ticket;
  }

  async updateTicket(
    id: string,
    dto: UpdateSupportTicketDto,
    actorId?: string,
    actorName?: string,
  ) {
    const store = this.prisma.getStore();
    const cleanId = id.trim().replace(/^#/, '');

    const ticket = (store.adminSupportTickets || []).find(
      (t: any) => t.id === cleanId || t.id.replace(/^#/, '') === cleanId,
    );

    if (!ticket) {
      throw new NotFoundException(`Support ticket '${id}' was not found.`);
    }

    const previousStatus = ticket.status;
    if (dto.status) {
      ticket.status = dto.status;
      if (dto.status === 'RESOLVED') {
        ticket.resolvedAt = new Date().toLocaleString();
      }
    }
    if (dto.assignee) ticket.assignee = dto.assignee;
    if (dto.resolutionRemarks) ticket.resolutionRemarks = dto.resolutionRemarks;

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'SUPPORT_TICKET_UPDATED' as any,
      entityId: ticket.id,
      entityName: ticket.subject,
      entityType: 'Customer' as any,
      summary: `Support ticket #${ticket.id} (${ticket.subject}) updated: ${previousStatus} -> ${ticket.status}`,
      targetDescription: `Ticket #${ticket.id} for Order ${ticket.orderNumber}`,
      changePayload: {
        previousStatus,
        newStatus: ticket.status,
        assignee: ticket.assignee,
        resolutionRemarks: ticket.resolutionRemarks,
      },
      entityLink: `/admin/support`,
    });

    return {
      success: true,
      message: `Support ticket #${ticket.id} updated successfully.`,
      ticket,
    };
  }
}

