import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  LIVE_TRACKING_ACTIVE_STATUSES,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
} from '../../common/contracts/order-contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

interface TrackingClient {
  ws: WebSocket;
  orderId?: string;
  orderNumber?: string;
  userId?: string;
  role?: string;
  isAlive: boolean;
}

export interface TrackingLocationBroadcast {
  latitude: number;
  longitude: number;
  heading?: number;
  accuracy?: number;
  speed?: number;
  etaMinutes?: number;
  updatedAt?: string;
  isStale?: boolean;
  status?: OrderStatus;
}

@Injectable()
export class TrackingRealtimeGateway
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TrackingRealtimeGateway.name);
  private wss?: WebSocketServer;
  private heartbeatInterval?: NodeJS.Timeout;
  private upgradeAttached = false;
  private readonly upgradeHandler = (
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ) => this.handleUpgrade(req, socket, head);
  private readonly rooms = new Map<string, Set<TrackingClient>>();
  private readonly clientContexts = new Map<WebSocket, TrackingClient>();
  private readonly pendingCloseTimers = new Set<NodeJS.Timeout>();
  private readonly orderSeqMap = new Map<string, number>();

  private nextSeq(orderId: string): number {
    const next = (this.orderSeqMap.get(orderId) || 0) + 1;
    this.orderSeqMap.set(orderId, next);
    return next;
  }

  constructor(
    @Optional() private readonly httpAdapterHost?: HttpAdapterHost,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

  onApplicationBootstrap() {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      void this.handleConnection(ws, req);
    });

    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer?.();
    if (httpServer && typeof httpServer.on === 'function' && !this.upgradeAttached) {
      httpServer.on('upgrade', this.upgradeHandler);
      this.upgradeAttached = true;
      this.logger.log(
        'WebSocket tracking gateway attached to primary HTTP server on /ws/tracking',
      );
    } else {
      this.logger.log(
        'WebSocket tracking gateway initialized in headless/noServer mode (/ws/tracking)',
      );
    }

    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      for (const ws of this.wss.clients) {
        const ctx = this.clientContexts.get(ws);
        if (ctx && !ctx.isAlive) {
          this.removeClient(ws);
          ws.terminate();
          continue;
        }
        if (ctx) ctx.isAlive = false;
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, 30000);
    this.heartbeatInterval.unref();
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    for (const t of this.pendingCloseTimers) {
      clearTimeout(t);
    }
    this.pendingCloseTimers.clear();

    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer?.();
    if (
      httpServer &&
      this.upgradeAttached &&
      typeof httpServer.off === 'function'
    ) {
      httpServer.off('upgrade', this.upgradeHandler);
    }
    this.upgradeAttached = false;

    for (const ws of this.clientContexts.keys()) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // ignore close errors during teardown
      }
    }
    this.rooms.clear();
    this.clientContexts.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    if (!this.wss) return;
    let pathname = '/';
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      pathname = parsed.pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== '/ws/tracking') {
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss?.emit('connection', ws, req);
    });
  }

  private extractBearerToken(req?: IncomingMessage, messageToken?: string): string | null {
    if (messageToken && typeof messageToken === 'string' && messageToken.trim()) {
      return messageToken.trim().replace(/^Bearer\s+/i, '');
    }

    const authHeader = req?.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.trim()) {
      return authHeader.trim().replace(/^Bearer\s+/i, '');
    }

    if (req?.url) {
      try {
        const parsed = new URL(req.url, 'http://localhost');
        const qToken = parsed.searchParams.get('token');
        if (qToken && qToken.trim()) {
          return qToken.trim();
        }
      } catch {
        // ignore malformed query string
      }
    }

    return null;
  }

  private async resolveAuthenticatedActor(token: string) {
    if (!token || !this.firebaseAdmin || !this.prisma?.isConnectedToDb) {
      return null;
    }

    let decoded: any = null;
    try {
      decoded = await this.firebaseAdmin.verifyIdToken(token);
    } catch {
      return null;
    }
    if (!decoded) return null;

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { firebaseUid: decoded.uid },
          ...(decoded.email ? [{ email: decoded.email }] : []),
          { id: decoded.uid },
        ],
      },
      include: {
        vendor: { select: { id: true } },
        driverProfile: { select: { id: true } },
      },
    });

    if (!user) return null;

    return {
      userId: user.id,
      role: String(user.role).toUpperCase(),
      vendorId: user.vendor?.id || null,
      driverProfileId: user.driverProfile?.id || null,
    };
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const ctx: TrackingClient = {
      ws,
      isAlive: true,
    };

    this.clientContexts.set(ws, ctx);

    const handshakeToken = this.extractBearerToken(req);
    const handshakeAuthPromise = handshakeToken
      ? (async () => {
          try {
            const actor = await this.resolveAuthenticatedActor(handshakeToken);
            if (actor) {
              ctx.userId = actor.userId;
              ctx.role = actor.role;
            }
          } catch {
            // fail closed on subscribe unless valid token is provided
          }
        })()
      : null;

    ws.on('pong', () => {
      ctx.isAlive = true;
    });

    ws.on('message', (raw) => {
      void (async () => {
        if (handshakeAuthPromise) {
          await handshakeAuthPromise;
        }
        await this.handleMessage(ws, req, raw.toString());
      })();
    });

    ws.on('close', () => {
      this.removeClient(ws);
    });

    ws.on('error', () => {
      this.removeClient(ws);
    });

    if (handshakeAuthPromise) {
      await handshakeAuthPromise;
    }

    this.sendJson(ws, {
      type: 'CONNECTED',
      path: '/ws/tracking',
      authenticated: Boolean(ctx.userId),
      timestamp: new Date().toISOString(),
    });
  }

  private async handleMessage(ws: WebSocket, req: IncomingMessage, raw: string) {
    const ctx = this.clientContexts.get(ws);
    if (!ctx) return;

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendJson(ws, { type: 'ERROR', message: 'Invalid JSON payload' });
      return;
    }

    const msgType = String(msg?.type || '').toUpperCase();

    if (msgType === 'PING') {
      ctx.isAlive = true;
      this.sendJson(ws, { type: 'PONG', timestamp: new Date().toISOString() });
      return;
    }

    if (msgType === 'SUBSCRIBE') {
      const targetOrderRef = String(msg?.orderId || '').trim();
      if (!targetOrderRef) {
        this.sendJson(ws, { type: 'ERROR', message: 'orderId is required to subscribe' });
        return;
      }

      if (!this.prisma?.isConnectedToDb) {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'SERVICE_UNAVAILABLE',
          message: 'Tracking persistence service is unavailable',
        });
        ws.close(1013, 'Service unavailable');
        return;
      }

      const token = this.extractBearerToken(req, msg?.token);
      if (!token) {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'UNAUTHORIZED',
          message: 'Valid Bearer token required to subscribe to order tracking',
        });
        ws.close(4001, 'Unauthorized');
        return;
      }

      const actor = await this.resolveAuthenticatedActor(token);
      if (!actor) {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'UNAUTHORIZED',
          message: 'Authentication token invalid or expired',
        });
        ws.close(4001, 'Unauthorized');
        return;
      }

      const order = await this.prisma!.order.findFirst({
        where: {
          OR: [{ id: targetOrderRef }, { orderNumber: targetOrderRef }],
        },
        include: {
          driverProfile: {
            select: {
              id: true,
              currentLat: true,
              currentLng: true,
              currentHeading: true,
            },
          },
        },
      });

      if (!order) {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'NOT_FOUND',
          message: `Order '${targetOrderRef}' not found`,
        });
        return;
      }

      const isAuthorized =
        actor.role === 'ADMIN' ||
        (actor.role === 'CUSTOMER' && order.customerId === actor.userId) ||
        (actor.role === 'VENDOR' && actor.vendorId && order.vendorId === actor.vendorId) ||
        (actor.role === 'DRIVER' &&
          (order.driverId === actor.userId ||
            (actor.driverProfileId && order.driverProfileId === actor.driverProfileId)));

      if (!isAuthorized) {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'FORBIDDEN',
          message: 'You do not have permission to subscribe to this order',
        });
        ws.close(4003, 'Forbidden');
        return;
      }

      // Leave previous room if re-subscribing
      if (ctx.orderId && ctx.orderId !== order.id) {
        this.rooms.get(ctx.orderId)?.delete(ctx);
      }

      ctx.userId = actor.userId;
      ctx.role = actor.role;
      ctx.orderId = order.id;
      ctx.orderNumber = order.orderNumber;

      if (!this.rooms.has(order.id)) {
        this.rooms.set(order.id, new Set());
      }
      this.rooms.get(order.id)!.add(ctx);

      const isLiveTrackingActive = LIVE_TRACKING_ACTIVE_STATUSES.includes(
        order.status as OrderStatus,
      );

      this.sendJson(ws, {
        type: 'SUBSCRIBED',
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        arrivedAt: order.arrivedAt ? order.arrivedAt.toISOString() : null,
        isArrived: Boolean(order.arrivedAt),
        trackingActive: isLiveTrackingActive,
        driverLocation:
          isLiveTrackingActive &&
          order.driverProfile?.currentLat != null &&
          order.driverProfile?.currentLng != null
            ? {
                latitude: order.driverProfile.currentLat,
                longitude: order.driverProfile.currentLng,
                heading: order.driverProfile.currentHeading ?? 0,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (msgType === 'LOCATION_UPDATE') {
      if (!ctx.orderId || ctx.role !== 'DRIVER') {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'FORBIDDEN',
          message: 'Only subscribed drivers may publish location updates',
        });
        return;
      }

      const lat = Number(msg?.latitude);
      const lng = Number(msg?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        this.sendJson(ws, { type: 'ERROR', message: 'Valid numeric coordinates required' });
        return;
      }

      if (this.prisma?.isConnectedToDb) {
        const order = await this.prisma.order.findUnique({
          where: { id: ctx.orderId },
          select: { id: true, status: true, driverProfileId: true },
        });
        if (!order || !LIVE_TRACKING_ACTIVE_STATUSES.includes(order.status as OrderStatus)) {
          return;
        }
        if (order.driverProfileId) {
          await this.prisma.driverProfile
            .update({
              where: { id: order.driverProfileId },
              data: {
                currentLat: lat,
                currentLng: lng,
                currentHeading: msg?.heading != null ? Number(msg.heading) : undefined,
              },
            })
            .catch(() => {});
        }
      }

      this.broadcastLocationUpdate(ctx.orderId, {
        latitude: lat,
        longitude: lng,
        heading: msg?.heading != null ? Number(msg.heading) : 0,
        accuracy: msg?.accuracy != null ? Number(msg.accuracy) : undefined,
        speed: msg?.speed != null ? Number(msg.speed) : undefined,
        etaMinutes: msg?.etaMinutes != null ? Number(msg.etaMinutes) : undefined,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  public broadcastLocationUpdate(
    orderId: string,
    location: TrackingLocationBroadcast,
  ) {
    if (!orderId) return;
    if (
      location.status &&
      !LIVE_TRACKING_ACTIVE_STATUSES.includes(location.status)
    ) {
      return;
    }

    const clients = this.rooms.get(orderId);
    if (!clients || clients.size === 0) return;

    const payload = {
      type: 'DRIVER_LOCATION',
      seq: this.nextSeq(orderId),
      orderId,
      latitude: location.latitude,
      longitude: location.longitude,
      heading: location.heading ?? 0,
      accuracy: location.accuracy,
      speed: location.speed,
      etaMinutes: location.etaMinutes,
      updatedAt: location.updatedAt || new Date().toISOString(),
      isStale: location.isStale ?? false,
    };

    for (const client of clients) {
      this.sendJson(client.ws, payload);
    }
  }

  public broadcastStatusUpdate(
    orderId: string,
    status: string,
    payload?: Record<string, any>,
  ) {
    if (!orderId) return;
    const clients = this.rooms.get(orderId);
    if (!clients || clients.size === 0) return;

    const rawEvent = payload?.event || payload?.eventType;
    const messageType =
      rawEvent === 'TRY_AND_BUY_UPDATED'
        ? 'TRY_AND_BUY_UPDATED'
        : rawEvent === 'ORDER_ARRIVED'
          ? 'ORDER_ARRIVED'
          : 'ORDER_STATUS_UPDATE';

    const message = {
      type: messageType,
      seq: this.nextSeq(orderId),
      orderId,
      status,
      ...(payload || {}),
      timestamp: new Date().toISOString(),
    };

    for (const client of clients) {
      this.sendJson(client.ws, message);
    }

    if (TERMINAL_ORDER_STATUSES.includes(status as OrderStatus)) {
      const closeTimer = setTimeout(() => {
        this.pendingCloseTimers.delete(closeTimer);
        const roomClients = this.rooms.get(orderId);
        if (!roomClients) return;
        for (const client of Array.from(roomClients)) {
          try {
            client.ws.close(1000, `Order reached terminal state ${status}`);
          } catch {
            // ignore close error
          }
          this.removeClient(client.ws);
        }
        this.rooms.delete(orderId);
        this.orderSeqMap.delete(orderId);
      }, 250);
      closeTimer.unref();
      this.pendingCloseTimers.add(closeTimer);
    }
  }

  private removeClient(ws: WebSocket) {
    const ctx = this.clientContexts.get(ws);
    if (!ctx) return;
    if (ctx.orderId) {
      const room = this.rooms.get(ctx.orderId);
      if (room) {
        room.delete(ctx);
        if (room.size === 0) {
          this.rooms.delete(ctx.orderId);
        }
      }
    }
    this.clientContexts.delete(ws);
  }

  private sendJson(ws: WebSocket, payload: Record<string, any>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
