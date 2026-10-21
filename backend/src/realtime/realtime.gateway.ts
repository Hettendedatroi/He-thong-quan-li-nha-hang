import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { resolveAuthUser } from '../common/auth/resolve-auth-user';
import { PERMISSIONS } from '../common/constants/permissions';
import { AuthUser, hasPermission, isStaff } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, rooms } from './realtime.service';

/**
 * Socket.IO gateway (NFR-01). Client kết nối:
 *   io(API_URL, { auth: { token?: <accessToken>, sessionToken?: <token phiên bàn>, deviceKey?: <mã thiết bị> } })
 * Server tự cho client vào các phòng phù hợp với vai trò.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
  }

  async handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as { token?: string; sessionToken?: string; deviceKey?: string };
    try {
      if (auth.token) {
        const user = await resolveAuthUser(this.prisma, this.jwt, auth.token);
        client.data.user = user;
        await client.join(rooms.user(user.id));
        if (isStaff(user)) {
          if (user.branchId) await this.joinBranchRooms(client, user, user.branchId);
          else await client.join(rooms.allStaff);
          if (hasPermission(user, PERMISSIONS.SYSTEM_MONITOR)) await client.join(rooms.system);
        }
      }
      if (auth.sessionToken) {
        const session = await this.prisma.tableSession.findUnique({ where: { token: auth.sessionToken } });
        if (session) await client.join(rooms.session(session.token));
      }
      if (auth.deviceKey) {
        const device = await this.prisma.device
          .update({
            where: { deviceKey: auth.deviceKey },
            data: { isOnline: true, lastSeenAt: new Date(), ipAddress: client.handshake.address },
          })
          .catch(() => null);
        if (device) {
          client.data.deviceId = device.id;
          await this.joinBranchRooms(client, null, device.branchId, device.type === 'KDS');
          this.realtime.toSystem('device.status', { id: device.id, isOnline: true, lastSeenAt: device.lastSeenAt });
        }
      }
    } catch (err) {
      client.emit('error', { message: (err as Error).message ?? 'Xác thực socket thất bại' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const deviceId = client.data.deviceId as number | undefined;
    if (!deviceId) return;
    const device = await this.prisma.device
      .update({ where: { id: deviceId }, data: { isOnline: false, lastSeenAt: new Date() } })
      .catch(() => null);
    if (device) this.realtime.toSystem('device.status', { id: device.id, isOnline: false, lastSeenAt: device.lastSeenAt });
  }

  /** Quản lý cấp chuỗi chọn chi nhánh để theo dõi */
  @SubscribeMessage('subscribe.branch')
  async subscribeBranch(@ConnectedSocket() client: Socket, @MessageBody() body: { branchId: number }) {
    const user = client.data.user as AuthUser | undefined;
    if (!isStaff(user) || !body?.branchId) return { ok: false };
    if (user!.branchId && user!.branchId !== Number(body.branchId)) return { ok: false };
    await this.joinBranchRooms(client, user!, Number(body.branchId));
    return { ok: true };
  }

  /** Khách theo dõi trạng thái đặt bàn của mình (FR-21) */
  @SubscribeMessage('subscribe.reservation')
  async subscribeReservation(@ConnectedSocket() client: Socket, @MessageBody() body: { code: string }) {
    if (!body?.code) return { ok: false };
    await client.join(rooms.reservation(body.code));
    return { ok: true };
  }

  /** Khách theo dõi phiên bàn (trạng thái món, hóa đơn - FR-14, FR-23) */
  @SubscribeMessage('subscribe.session')
  async subscribeSession(@ConnectedSocket() client: Socket, @MessageBody() body: { sessionToken: string }) {
    if (!body?.sessionToken) return { ok: false };
    const session = await this.prisma.tableSession.findUnique({ where: { token: body.sessionToken } });
    if (!session) return { ok: false };
    await client.join(rooms.session(session.token));
    return { ok: true };
  }

  /** Thiết bị gửi heartbeat định kỳ (FR-ADM-11) */
  @SubscribeMessage('device.heartbeat')
  async heartbeat(@ConnectedSocket() client: Socket) {
    const deviceId = client.data.deviceId as number | undefined;
    if (!deviceId) return { ok: false };
    await this.prisma.device.update({ where: { id: deviceId }, data: { isOnline: true, lastSeenAt: new Date() } });
    return { ok: true };
  }

  private async joinBranchRooms(client: Socket, user: AuthUser | null, branchId: number, forceKitchen = false) {
    await client.join(rooms.branchStaff(branchId));
    if (forceKitchen || (user && hasPermission(user, PERMISSIONS.KITCHEN_VIEW))) {
      await client.join(rooms.kitchen(branchId));
    }
    this.logger.debug(`Socket ${client.id} joined branch ${branchId}`);
  }
}
