import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Tên các "phòng" Socket.IO. */
export const rooms = {
  branchStaff: (branchId: number) => `branch:${branchId}:staff`,
  kitchen: (branchId: number) => `branch:${branchId}:kitchen`,
  /** Nhân viên cấp chuỗi (không gắn chi nhánh) nhận sự kiện của mọi chi nhánh */
  allStaff: 'staff:all',
  session: (token: string) => `session:${token}`,
  user: (userId: number) => `user:${userId}`,
  reservation: (code: string) => `reservation:${code}`,
  system: 'system',
};

/**
 * Đồng bộ thời gian thực giữa khách - phục vụ - bếp (NFR-01).
 * Các service nghiệp vụ gọi các hàm này sau khi ghi DB.
 */
@Injectable()
export class RealtimeService {
  private server?: Server;

  setServer(server: Server) {
    this.server = server;
  }

  emit(room: string | string[], event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  toBranchStaff(branchId: number, event: string, payload: unknown) {
    this.emit([rooms.branchStaff(branchId), rooms.allStaff], event, payload);
  }

  toKitchen(branchId: number, event: string, payload: unknown) {
    this.emit(rooms.kitchen(branchId), event, payload);
  }

  toSession(token: string, event: string, payload: unknown) {
    this.emit(rooms.session(token), event, payload);
  }

  toUser(userId: number, event: string, payload: unknown) {
    this.emit(rooms.user(userId), event, payload);
  }

  toReservation(code: string, event: string, payload: unknown) {
    this.emit(rooms.reservation(code), event, payload);
  }

  toSystem(event: string, payload: unknown) {
    this.emit(rooms.system, event, payload);
  }

  /** Phát cho tất cả client (vd: món hết hàng -> cập nhật menu khách) */
  broadcast(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }

  connectedClients(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }
}
