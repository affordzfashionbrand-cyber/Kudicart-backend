import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { verifyJwtToken } from '../../common/utils/crypto.util';
import { Role } from '../../common/enums/role.enum';

interface ClientContext {
  ws: WebSocket;
  userId?: string;
  role?: string;
  orderId?: string;
  isAlive: boolean;
}

@Injectable()
export class TrackingRealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingRealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly clientMap = new Map<WebSocket, ClientContext>();
  private readonly orderSeqMap = new Map<string, number>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private redisPub: Redis | null = null;
  private redisSub: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  onModuleInit() {
    const port = Number(process.env.TRACKING_WS_PORT) || 8081;
    try {
      this.wss = new WebSocketServer({ port, path: '/ws/tracking' }, () => {
        this.logger.log(`Authenticated Tracking WebSocket Server listening on port ${port} at /ws/tracking`);
      });

      this.wss.on('connection', (ws: WebSocket, req: any) => {
        this.handleConnection(ws, req);
      });

      this.heartbeatInterval = setInterval(() => {
        this.wss?.clients.forEach((ws) => {
          const client = this.clientMap.get(ws);
          if (client) {
            if (!client.isAlive) {
              this.logger.debug(`Terminating inactive socket for user ${client.userId || 'unknown'}`);
              ws.terminate();
              this.clientMap.delete(ws);
              return;
            }
            client.isAlive = false;
            try {
              ws.ping();
            } catch {}
          }
        });
      }, 30000);

      // Multi-instance distributed synchronization via shared Redis Pub/Sub
      const redisHost = process.env.REDIS_HOST;
      if (redisHost || process.env.REDIS_ENABLED === 'true') {
        const redisOptions = {
          host: redisHost || '127.0.0.1',
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: true,
          connectTimeout: 2000,
        };
        try {
          this.redisPub = new Redis(redisOptions);
          this.redisSub = new Redis(redisOptions);

          this.redisPub.connect().catch((err) => {
            this.logger.warn(`Redis pub client standby: ${err?.message}`);
          });

          this.redisSub.connect().then(() => {
            this.redisSub?.subscribe('kudicart:tracking:events', (err) => {
              if (!err) {
                this.logger.log('Tracking Gateway subscribed to Redis pub/sub channel kudicart:tracking:events');
              }
            });
          }).catch((err) => {
            this.logger.warn(`Redis sub client standby: ${err?.message}`);
          });

          this.redisSub.on('message', (_channel, messageStr) => {
            try {
              const data = JSON.parse(messageStr);
              if (data?.orderId) {
                this.deliverToLocalRoom(data.orderId, messageStr);
              }
            } catch {}
          });
        } catch (err: any) {
          this.logger.warn(`Redis Pub/Sub initialization deferred: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to initialize WebSocketServer on port ${port}: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.redisPub) {
      this.redisPub.disconnect();
      this.redisPub = null;
    }
    if (this.redisSub) {
      this.redisSub.disconnect();
      this.redisSub = null;
    }
  }

  private handleConnection(ws: WebSocket, req: any) {
    const clientCtx: ClientContext = {
      ws,
      isAlive: true,
    };
    this.clientMap.set(ws, clientCtx);
    this.logger.log('[TrackingGateway] Client WebSocket connection established');

    ws.on('pong', () => {
      clientCtx.isAlive = true;
    });

    // Check if query params have token and orderId: e.g. /ws/tracking?token=...&orderId=...
    if (req?.url) {
      try {
        const urlObj = new URL(req.url, 'http://localhost');
        const token = urlObj.searchParams.get('token');
        const orderId = urlObj.searchParams.get('orderId');
        if (token && orderId) {
          this.authenticateAndSubscribe(ws, token, orderId);
        }
      } catch {}
    }

    ws.on('message', async (data: any) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'auth') {
          await this.authenticateAndSubscribe(ws, parsed.token, parsed.orderId);
        } else if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err: any) {
        this.logger.warn(`Invalid message from WebSocket client: ${err.message}`);
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      this.logger.warn(`WebSocket error: ${err.message}`);
      this.handleDisconnect(ws);
    });
  }

  private async authenticateAndSubscribe(ws: WebSocket, token: string, orderId: string) {
    const clientCtx = this.clientMap.get(ws);
    if (!clientCtx) return;

    try {
      // 1. Verify token
      let user: any = null;
      const jwtResult = verifyJwtToken(token);
      if (jwtResult.valid && jwtResult.payload) {
        user = {
          uid: jwtResult.payload.uid || jwtResult.payload.sub,
          role: jwtResult.payload.role,
          phone: jwtResult.payload.phone,
          driverId: jwtResult.payload.driverId,
        };
      } else if (this.firebaseAdmin) {
        try {
          const decoded = await this.firebaseAdmin.verifyIdToken(token);
          if (decoded) {
            user = {
              uid: decoded.uid,
              role: (decoded as any).role || Role.CUSTOMER,
            };
          }
        } catch {}
      }

      if (!user && (process.env.NODE_ENV !== 'production')) {
        // Fallback for dev / mock testing tokens
        if (token.startsWith('demo-') || token === 'dev-token-usr-1') {
          user = { uid: 'usr-1', role: Role.CUSTOMER };
        } else if (token === 'dev-token-driver-1') {
          user = { uid: 'usr-driver-1', driverId: 'drv-1', role: Role.DRIVER };
        }
      }

      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Authentication required' }));
        ws.close(4001, 'Unauthorized');
        return;
      }

      // 2. Authorize order ownership
      const isAuthorized = await this.verifyOrderOwnership(user, orderId);
      if (!isAuthorized) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Not authorized for this order' }));
        ws.close(4003, 'Forbidden');
        return;
      }

      // Leave old room if already in one
      if (clientCtx.orderId && clientCtx.orderId !== orderId) {
        this.leaveRoom(clientCtx.orderId, ws);
      }

      clientCtx.userId = user.uid || user.id;
      clientCtx.role = user.role;
      clientCtx.orderId = orderId;

      this.joinRoom(orderId, ws);
      this.logger.log(
        `[TrackingGateway] Room subscription: client ${clientCtx.userId} subscribed to order ${orderId} (role: ${clientCtx.role})`,
      );

      ws.send(
        JSON.stringify({
          type: 'subscribed',
          orderId,
          timestamp: Date.now(),
        }),
      );
    } catch (err: any) {
      this.logger.error(`WebSocket auth failed: ${err.message}`);
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Authentication failed' }));
    }
  }

  private async verifyOrderOwnership(user: any, orderId: string): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;

    // Check DB or Store
    const store = this.prisma.getStore();
    const order = store.orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (!order) return false;

    if (user.role === Role.CUSTOMER) {
      return order.customerId === user.uid || order.customerId === user.id;
    }

    if (user.role === Role.DRIVER) {
      const driverId = user.driverId || user.id;
      return order.driverId === driverId;
    }

    return false;
  }

  private joinRoom(orderId: string, ws: WebSocket) {
    if (!this.rooms.has(orderId)) {
      this.rooms.set(orderId, new Set());
    }
    this.rooms.get(orderId)!.add(ws);
    this.logger.debug(`Socket joined room ${orderId} (room size: ${this.rooms.get(orderId)!.size})`);
  }

  private leaveRoom(orderId: string, ws: WebSocket) {
    const room = this.rooms.get(orderId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(orderId);
      }
    }
  }

  private handleDisconnect(ws: WebSocket) {
    const client = this.clientMap.get(ws);
    if (client?.orderId) {
      this.leaveRoom(client.orderId, ws);
      this.logger.log(`[TrackingGateway] Client disconnected (order: ${client.orderId}, user: ${client.userId || 'anonymous'})`);
    } else {
      this.logger.log('[TrackingGateway] Client disconnected (no active room)');
    }
    this.clientMap.delete(ws);
  }

  /**
   * Delivers a serialized message to local WebSocket connections in a room.
   */
  private deliverToLocalRoom(orderId: string, message: string) {
    const room = this.rooms.get(orderId);
    if (!room || room.size === 0) return;

    room.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (e: any) {
          this.logger.warn(`Failed to send message to socket: ${e.message}`);
        }
      }
    });
  }

  /**
   * Broadcasts an authoritative live location event to clients subscribed to this order.
   * Dispatches via Redis Pub/Sub if active, otherwise delivers locally.
   */
  public broadcastLocationUpdate(
    orderId: string,
    locationData: {
      latitude: number;
      longitude: number;
      heading?: number;
      accuracy?: number;
      speed?: number;
      updatedAt: string;
      isStale?: boolean;
    },
    route?: any,
  ) {
    const seq = (this.orderSeqMap.get(orderId) || 0) + 1;
    this.orderSeqMap.set(orderId, seq);

    const message = JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      orderId,
      location: locationData,
      route: route || null,
      seq,
      timestamp: Date.now(),
    });

    if (this.redisPub && this.redisPub.status === 'ready') {
      this.redisPub.publish('kudicart:tracking:events', message).catch(() => {
        this.deliverToLocalRoom(orderId, message);
      });
    } else {
      this.deliverToLocalRoom(orderId, message);
    }
  }

  /**
   * Broadcasts order status changes (e.g. ASSIGNED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED).
   * Automatically performs delivery completion room cleanup on terminal states.
   */
  public broadcastStatusUpdate(orderId: string, status: string, payload?: any) {
    const seq = (this.orderSeqMap.get(orderId) || 0) + 1;
    this.orderSeqMap.set(orderId, seq);

    const message = JSON.stringify({
      type: 'ORDER_STATUS_UPDATE',
      orderId,
      status,
      payload,
      seq,
      timestamp: Date.now(),
    });

    if (this.redisPub && this.redisPub.status === 'ready') {
      this.redisPub.publish('kudicart:tracking:events', message).catch(() => {
        this.deliverToLocalRoom(orderId, message);
      });
    } else {
      this.deliverToLocalRoom(orderId, message);
    }

    // Terminal state cleanup (DELIVERED, CANCELLED, RETURNED)
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(status)) {
      setTimeout(() => {
        const room = this.rooms.get(orderId);
        if (room) {
          room.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.close(1000, `Order ${status.toLowerCase()}`);
              } catch {}
            }
          });
          this.rooms.delete(orderId);
        }
        this.orderSeqMap.delete(orderId);
      }, 2000);
    }
  }
}
