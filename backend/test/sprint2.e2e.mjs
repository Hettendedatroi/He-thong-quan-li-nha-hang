/**
 * Kiểm thử backend Sprint 2 theo Product Backlog: US-2, US-8, US-12, US-13 + hồi quy Sprint 1 (DoD F-04).
 *
 * Yêu cầu: server đang chạy, DB vừa migrate + seed (tài khoản, 10 món, 8 bàn), các bàn đang Trống.
 *   BASE_URL=http://localhost:3000 npm run test:sprint2   (hoặc npm run test:e2e để chạy cả Sprint 1 + 2)
 *
 * Mỗi kiểm tra ghi rõ AC / DoD để đối chiếu vào bảng AC - Test case (DoD A-01, F-03).
 * Lưu ý: kết quả phụ thuộc dữ liệu seed, không chạy trên database thật / server dùng chung.
 */
import { io } from 'socket.io-client';
import {
  BASE,
  PASSWORD,
  call,
  check,
  expectRejected,
  expectStatus,
  isFriendly,
  login,
  messageOf,
  prisma,
  run,
  section,
  sleep,
} from './helpers.mjs';

const LOAD_SECONDS = Number(process.env.LOAD_SECONDS ?? 15);

function socketOf(auth) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth, transports: ['websocket'], reconnection: true, reconnectionDelay: 200 });
    const timer = setTimeout(() => reject(new Error('Socket không kết nối được')), 5000);
    s.once('connect', () => {
      clearTimeout(timer);
      // Server cho client vào phòng ngay sau khi kết nối
      setTimeout(() => resolve(s), 150);
    });
  });
}
function waitEvent(socket, event, predicate = () => true, timeout = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve({ ms: Date.now() - started, payload });
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeout);
    socket.on(event, handler);
  });
}

const openQr = async (table) => {
  const r = await call('POST', `/public/tables/${table.qrToken}/session`);
  return { token: r.data.sessionToken, id: r.data.sessionId, S: `/public/sessions/${r.data.sessionToken}` };
};
const lineTotal = (items) =>
  items.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + i.unitPrice * i.quantity - i.discountAmount, 0);

async function main() {
  section('Chuẩn bị');
  const manager = await login('manager');
  const waiter = await login('waiter1');
  const kitchen = await login('kitchen');
  const customer = await login('customer@example.com');
  if (!manager || !waiter || !kitchen || !customer) throw new Error('Không đăng nhập được tài khoản seed');

  const tables = (await call('GET', '/admin/tables?branchId=1', { token: manager })).data.filter(
    (t) => t.isActive && t.capacity < 12,
  );
  if (tables.length < 6) throw new Error('Cần ít nhất 6 bàn Trống');
  const [T1, T2, T3, T4, T5, T6] = tables;
  const menu = (await call('GET', '/public/menu')).data.categories.flatMap((c) => c.items);
  const [D1, D2, D3] = menu.filter((i) => i.inStock);

  // ------------------------------------------------------------------ Hồi quy Sprint 1
  section('DoD F-04: hồi quy Sprint 1');
  const wrong = await call('POST', '/auth/login', { body: { identifier: 'waiter1', password: 'sai-mat-khau' } });
  expectStatus('US-7 AC1', 'Sai mật khẩu bị từ chối', wrong, 401);
  check('US-7 AC1', 'Lỗi đăng nhập chung chung', /tài khoản hoặc mật khẩu/.test(messageOf(wrong)), messageOf(wrong));
  expectStatus('US-7 AC2', '401 khi chưa đăng nhập', await call('GET', '/tables/floor-plan'), 401);
  expectStatus('US-7 AC2', '403 khi sai vai trò', await call('GET', '/admin/users', { token: kitchen }), 403);
  expectStatus('US-16 AC1', 'Giá món 0 bị từ chối', await call('POST', '/menu/items', {
    token: manager,
    body: { categoryId: menu[0].categoryId, name: 'Giá 0', price: 0 },
  }), 400);
  const badQr = await call('POST', '/public/tables/khong-ton-tai/session');
  expectRejected('US-1 AC1', 'QR không hợp lệ', badQr, 404);
  check('US-1 AC2', 'Thực đơn có món và tình trạng còn hàng', menu.length > 0 && menu.every((i) => typeof i.inStock === 'boolean'));

  // Sau nginx / Cloudflare: mỗi người một hạn mức, và không lách được bằng X-Forwarded-For giả
  section('NFR-03: hạn mức đăng nhập theo từng IP');
  const attempt = (ip) => call('POST', '/auth/login', { body: { identifier: 'khong-co', password: 'x' }, ip });
  const perPerson = [];
  for (let i = 1; i <= 12; i++) perPerson.push((await attempt(`10.60.0.${i}`)).status);
  check('NFR-03', '12 người khác IP đăng nhập không chặn nhau', perPerson.every((s) => s === 401), perPerson.join(' '));
  const spoofed = [];
  for (let i = 1; i <= 11; i++) spoofed.push((await attempt(`1.2.3.${i}, 10.60.1.1`)).status);
  check('NFR-03', 'Một IP thử sai quá 10 lần bị chặn, giả X-Forwarded-For không lách được', spoofed[9] === 401 && spoofed[10] === 429, spoofed.join(' '));

  // ------------------------------------------------------------------ US-2
  section('US-2: giỏ hàng và gửi đơn');
  const A = await openQr(T1);
  for (const [q, label] of [[0, '0'], [21, '21'], [-1, 'âm'], [1.5, 'lẻ']]) {
    expectRejected('US-2 AC1', `Số lượng ${label} bị từ chối`, await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D1.id, quantity: q } }));
  }
  expectRejected('US-2 AC1', 'Thiếu số lượng bị từ chối', await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D1.id } }));
  expectRejected('US-2 AC1', 'Ghi chú 101 ký tự bị từ chối', await call('POST', `${A.S}/cart/items`, {
    body: { menuItemId: D1.id, quantity: 1, note: 'x'.repeat(101) },
  }));
  expectRejected('US-2 AC1', 'Gửi đơn trực tiếp với số lượng 21 bị từ chối', await call('POST', `${A.S}/orders`, {
    body: { items: [{ menuItemId: D1.id, quantity: 21 }] },
  }));
  expectStatus('US-2 AC1', 'Số lượng 20 (biên trên) hợp lệ', await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D3.id, quantity: 20 } }), 201);
  await call('DELETE', `${A.S}/cart`);
  expectStatus('US-2 AC1', 'Ghi chú 100 ký tự (biên trên) hợp lệ', await call('POST', `${A.S}/cart/items`, {
    body: { menuItemId: D3.id, quantity: 1, note: 'y'.repeat(100) },
  }), 201);
  await call('DELETE', `${A.S}/cart`);

  expectRejected('US-2 AC3', 'Giỏ trống không gửi được', await call('POST', `${A.S}/orders`, { body: {} }));
  const add1 = await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D1.id, quantity: 2, note: 'Ít cay' } });
  const add2 = await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D2.id, quantity: 1 } });
  check('US-2 AC1', 'Giỏ hiển thị tổng tiền tạm tính', add2.data.total === add2.data.items.reduce((s, i) => s + i.amount, 0) && add2.data.total > 0);
  check('US-2 AC1', 'Tổng tăng theo món thêm', add2.data.total > add1.data.total);

  // Món hết hàng trong giỏ: không gửi được, giỏ giữ nguyên
  await call('PATCH', `/kitchen/menu-items/${D2.id}/availability`, { token: kitchen, body: { isAvailable: false } });
  const soldOut = await call('POST', `${A.S}/orders`, { body: {} });
  expectRejected('US-2 AC3', 'Giỏ có món hết hàng không gửi được', soldOut);
  check('US-2 AC3', 'Lỗi nêu tên món hết hàng', messageOf(soldOut).includes(D2.name), messageOf(soldOut));
  check('US-2 AC3', 'Giỏ giữ nguyên sau khi gửi lỗi', (await call('GET', `${A.S}/cart`)).data.items.length === 2);
  expectRejected('US-2 AC3', 'Thêm món hết hàng vào giỏ bị từ chối', await call('POST', `${A.S}/cart/items`, { body: { menuItemId: D2.id, quantity: 1 } }));
  await call('PATCH', `/kitchen/menu-items/${D2.id}/availability`, { token: kitchen, body: { isAvailable: true } });

  const o1 = await call('POST', `${A.S}/orders`, { body: { note: 'Mang ra cùng lúc' } });
  expectStatus('US-2 AC2', 'Gửi đơn thành công', o1, 201);
  const item1 = o1.data.items.find((i) => i.menuItemId === D1.id);
  check('US-2 AC2', 'Đơn có số đơn, bàn, món, ghi chú, thời gian',
    o1.data.code && o1.data.table?.code === T1.code && item1?.quantity === 2 && item1?.note === 'Ít cay' && o1.data.createdAt);
  check('US-2 AC2', 'Giỏ trống sau khi gửi', (await call('GET', `${A.S}/cart`)).data.items.length === 0);

  const o2 = await call('POST', `${A.S}/orders`, { body: { items: [{ menuItemId: D3.id, quantity: 3 }] } });
  expectStatus('US-2 AC4', 'Gọi thêm trong bữa ăn', o2, 201);
  const detail = (await call('GET', A.S)).data;
  check('US-2 AC4', 'Các đơn cùng một phiên bàn', detail.orders.length === 2);
  check('DoD A-06', 'Tạm tính khớp tính tay', detail.estimate.subtotal - detail.estimate.itemDiscount === lineTotal(detail.orders.flatMap((o) => o.items)));

  // Giá trong giỏ phải khớp giá khi gửi đơn, kể cả lúc có khuyến mãi tự động
  section('DoD A-06: tổng giỏ khớp đơn khi có khuyến mãi');
  const promo = await call('POST', '/promotions', {
    token: manager,
    body: { name: 'Test 20%', type: 'PERCENT', value: 20, startAt: new Date(Date.now() - 3600e3).toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString() },
  });
  const P = await openQr(T6);
  const pc = await call('POST', `${P.S}/cart/items`, { body: { menuItemId: D1.id, quantity: 2 } });
  const po = await call('POST', `${P.S}/orders`, { body: {} });
  check('DoD A-06', 'Tổng giỏ = tổng đơn khi có khuyến mãi', pc.data.total === lineTotal(po.data.items), `giỏ ${pc.data.total} / đơn ${lineTotal(po.data.items)}`);
  const poItem = po.data.items[0];
  const changed = await call('PATCH', `/order-items/${poItem.id}`, { token: waiter, body: { quantity: 4 } });
  check('DoD A-06', 'Đổi số lượng thì tính lại giảm giá', changed.data.discountAmount === poItem.discountAmount * 2, `${poItem.discountAmount} -> ${changed.data.discountAmount}`);
  await call('DELETE', `/promotions/${promo.data.id}`, { token: manager });

  // ------------------------------------------------------------------ US-13
  section('US-13: màn hình bếp');
  await sleep(1100);
  const wo = await call('POST', '/orders', { token: waiter, body: { tableId: T2.id, items: [{ menuItemId: D1.id, quantity: 1, note: 'Không hành' }], priority: 2 } });
  const queue = (await call('GET', '/kitchen/queue', { token: kitchen })).data.orders;
  const ids = queue.map((o) => o.id);
  check('US-13 AC1', 'Sắp xếp cũ nhất trước (kể cả đơn gấp)', ids.indexOf(o1.data.id) !== -1 && ids.indexOf(o1.data.id) < ids.indexOf(wo.data.id));
  const q1 = queue.find((o) => o.id === o1.data.id);
  const qItem = q1?.items.find((i) => i.note === 'Ít cay');
  check('US-13 AC1', 'Có bàn, thời gian, món, số lượng, ghi chú', q1?.table?.code === T1.code && q1?.sentAt && qItem?.name && qItem?.quantity === 2);
  check('US-13 AC1', 'Đơn mới được đánh dấu', q1?.isNew === true);

  const iid = item1.id;
  const statusOf = (status, token = kitchen, id = iid) => call('PATCH', `/kitchen/items/${id}/status`, { token, body: { status } });
  expectRejected('US-13 AC2', 'Bỏ bước PENDING -> PREPARING bị từ chối', await statusOf('PREPARING'));
  expectRejected('US-13 AC2', 'Bỏ bước PENDING -> READY bị từ chối', await statusOf('READY'));
  expectRejected('US-13 AC2', 'Trạng thái lạ bị từ chối', await statusOf('XONG'));
  expectStatus('DoD B-02', 'Chưa đăng nhập đổi trạng thái: 401', await call('PATCH', `/kitchen/items/${iid}/status`, { body: { status: 'RECEIVED' } }), 401);
  expectStatus('DoD B-02', 'Phục vụ đổi trạng thái bếp: 403', await statusOf('RECEIVED', waiter), 403);
  expectStatus('US-13 AC2', 'Đã nhận', await statusOf('RECEIVED'), 200);
  expectRejected('US-13 AC2', 'Không lặp lại / lùi về PENDING-RECEIVED', await statusOf('RECEIVED'));
  expectStatus('US-13 AC2', 'Đang chuẩn bị', await statusOf('PREPARING'), 200);
  expectRejected('US-13 AC2', 'Lùi về Đã nhận bị từ chối', await statusOf('RECEIVED'));
  expectStatus('US-13 AC2', 'Sẵn sàng', await statusOf('READY'), 200);
  const stamped = (await call('GET', `/orders/${o1.data.id}`, { token: waiter })).data.items.find((i) => i.id === iid);
  check('US-13 AC3', 'Ghi thời gian mỗi lần đổi trạng thái', stamped.receivedAt && stamped.startedAt && stamped.readyAt);
  const auditCount = await prisma.auditLog.count({ where: { action: 'order_item.status', entityId: String(iid), userId: { not: null } } });
  check('DoD B-05', 'Ghi người thực hiện đổi trạng thái', auditCount === 3, `${auditCount} dòng`);

  for (const s of ['RECEIVED', 'PREPARING', 'READY']) await call('POST', `/kitchen/orders/${o1.data.id}/status`, { token: kitchen, body: { status: s } });
  const served = await call('POST', `/orders/${o1.data.id}/serve`, { token: waiter });
  expectStatus('US-13 AC4', 'Phục vụ đánh dấu Đã phục vụ', served, 201);
  const after = (await call('GET', '/kitchen/queue', { token: kitchen })).data.orders;
  check('US-13 AC4', 'Đơn đã phục vụ rời danh sách bếp', !after.some((o) => o.id === o1.data.id));
  const history = (await call('GET', '/orders?limit=100', { token: kitchen })).data.items;
  check('US-13 AC4', 'Đơn vẫn còn trong lịch sử', history.some((o) => o.id === o1.data.id));

  // ------------------------------------------------------------------ US-8
  section('US-8: hóa đơn và thanh toán');
  const extra = await call('POST', `${A.S}/orders`, { body: { items: [{ menuItemId: D2.id, quantity: 1 }] } });
  await call('POST', `/order-items/${extra.data.items[0].id}/cancel`, { token: waiter, body: { reason: 'Khách đổi ý' } });

  expectStatus('DoD B-02', 'Chưa đăng nhập lập hóa đơn: 401', await call('POST', '/bills', { body: { sessionId: A.id } }), 401);
  expectStatus('DoD B-02', 'Bếp lập hóa đơn: 403', await call('POST', '/bills', { token: kitchen, body: { sessionId: A.id } }), 403);
  expectStatus('DoD B-02', 'Khách đăng nhập lập hóa đơn: 403', await call('POST', '/bills', { token: customer, body: { sessionId: A.id } }), 403);
  const bill = await call('POST', '/bills', { token: waiter, body: { sessionId: A.id } });
  expectStatus('US-8 AC1', 'Lập hóa đơn', bill, 201);
  const live = (await call('GET', A.S)).data.orders.flatMap((o) => o.items);
  const activeCount = live.filter((i) => i.status !== 'CANCELLED').length;
  check('US-8 AC1', 'Không tính món đã hủy', bill.data.lines.length === activeCount && !bill.data.lines.some((l) => l.orderItemId === extra.data.items[0].id));
  check('US-8 AC1', 'Dòng có số lượng, đơn giá, thành tiền', bill.data.lines.every((l) => l.quantity > 0 && l.unitPrice > 0 && l.amount === l.unitPrice * l.quantity - l.discount));
  const b = bill.data;
  check('DoD A-06', 'Tổng hóa đơn khớp tính tay',
    b.subtotal - b.itemDiscount - b.voucherDiscount - b.manualDiscount - b.pointsDiscount + b.serviceCharge + b.vatAmount === b.total && b.subtotal === bill.data.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  check('US-8 AC4', 'Có đủ dữ liệu để in hóa đơn', (await call('GET', `/bills/${b.id}`, { token: waiter })).data.lines?.length === bill.data.lines.length);

  // Gọi thêm món sau khi đã lập hóa đơn: không được bỏ sót tiền món mới (US-2 AC4)
  section('US-2 AC4 + US-8 AC1: gọi thêm sau khi lập hóa đơn');
  const late = await call('POST', `${A.S}/orders`, { body: { items: [{ menuItemId: D3.id, quantity: 1 }] } });
  if (late.status === 201) {
    const stale = await call('POST', `/bills/${b.id}/payments`, { token: waiter, body: { method: 'CASH', amount: b.total } });
    check('US-2 AC4', 'Không thu tiền hóa đơn đã thiếu món mới', stale.status === 409, `HTTP ${stale.status} - hóa đơn ${b.total}`);
    check('DoD A-04', 'Có hướng dẫn lập lại hóa đơn', stale.status !== 409 || isFriendly(stale), messageOf(stale));
  } else {
    check('US-2 AC4', 'Gọi thêm sau khi lập hóa đơn', false, `HTTP ${late.status}`);
  }

  const P2 = await openQr(T3);
  const p2o = await call('POST', `${P2.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 2 }] } });
  const p2b = await call('POST', '/bills', { token: waiter, body: { sessionId: P2.id } });
  const editedPrice = await call('PATCH', `/order-items/${p2o.data.items[0].id}`, { token: waiter, body: { quantity: 5 } });
  check('US-8 AC1', 'Không đổi số lượng món đã nằm trong hóa đơn', editedPrice.status === 400, `HTTP ${editedPrice.status}`);
  const part = await call('POST', `/bills/${p2b.data.id}/payments`, { token: waiter, body: { method: 'CASH', amount: 1000 } });
  expectStatus('US-8', 'Thu một phần', part, 201);
  const lateAfterPart = await call('POST', `${P2.S}/orders`, { body: { items: [{ menuItemId: D3.id, quantity: 1 }] } });
  check('US-2 AC4', 'Đang thu tiền dở thì không gọi thêm được (tránh đơn mồ côi)', lateAfterPart.status === 409, `HTTP ${lateAfterPart.status}`);

  // Lập lại hóa đơn cho bàn A rồi thanh toán
  const bill2 = await call('POST', '/bills', { token: waiter, body: { sessionId: A.id } });
  expectStatus('US-8 AC1', 'Lập lại hóa đơn bao gồm món mới', bill2, 201);
  const allItems = (await call('GET', A.S)).data.orders.flatMap((o) => o.items);
  check('DoD A-06', 'Hóa đơn gồm tất cả món chưa hủy', bill2.data.lines.length === allItems.filter((i) => i.status !== 'CANCELLED').length);

  expectRejected('DoD A-03', 'Số tiền 0 bị từ chối', await call('POST', `/bills/${bill2.data.id}/payments`, { token: waiter, body: { method: 'CASH', amount: 0 } }));
  expectRejected('DoD A-03', 'Phương thức lạ bị từ chối', await call('POST', `/bills/${bill2.data.id}/payments`, { token: waiter, body: { method: 'VANG', amount: 1000 } }));
  expectStatus('DoD B-02', 'Bếp xác nhận thanh toán: 403', await call('POST', `/bills/${bill2.data.id}/payments`, { token: kitchen, body: { method: 'CASH', amount: 1000 } }), 403);
  const pay = await call('POST', `/bills/${bill2.data.id}/payments`, { token: waiter, body: { method: 'CASH', amount: bill2.data.total + 50000 } });
  expectStatus('US-8 AC2', 'Xác nhận thanh toán tiền mặt', pay, 201);
  check('US-8 AC2', 'Hóa đơn thành Đã thanh toán, thối tiền đúng', pay.data.bill?.status === 'PAID' && pay.data.change === 50000);
  const fp = (await call('GET', '/tables/floor-plan', { token: waiter })).data.zones.flatMap((z) => z.tables);
  check('US-8 AC2', 'Bàn chuyển Đang dọn dẹp', fp.find((t) => t.id === T1.id)?.status === 'CLEANING');
  check('DoD B-05', 'Ghi nhật ký thanh toán', (await prisma.auditLog.count({ where: { action: 'payment.confirm', entityId: String(bill2.data.id) } })) === 1);

  expectRejected('US-8 AC3', 'Hóa đơn đã trả không thu thêm được', await call('POST', `/bills/${bill2.data.id}/payments`, { token: waiter, body: { method: 'CASH', amount: 1000 } }));
  expectRejected('US-8 AC3', 'Hóa đơn đã trả không tạo lại được', await call('POST', '/bills', { token: waiter, body: { sessionId: A.id } }));
  expectRejected('US-8 AC3', 'Hóa đơn đã trả không tách được', await call('POST', `/bills/${bill2.data.id}/split`, { token: waiter, body: { mode: 'EQUAL', parts: 2 } }));
  const pending = allItems.find((i) => ['PENDING', 'RECEIVED'].includes(i.status));
  if (pending) {
    const editPaid = await call('PATCH', `/order-items/${pending.id}`, { token: waiter, body: { quantity: 9 } });
    check('US-8 AC3', 'Không sửa món của hóa đơn đã trả', editPaid.status === 400, `HTTP ${editPaid.status}`);
  }
  expectStatus('US-2 AC4', 'Phiên đã đóng không gọi thêm được', await call('POST', `${A.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 1 }] } }), 410);

  const T = await openQr(T4);
  await call('POST', `${T.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 1 }] } });
  const tb = await call('POST', '/bills', { token: waiter, body: { sessionId: T.id } });
  const tp = await call('POST', `/bills/${tb.data.id}/payments`, { token: waiter, body: { method: 'BANK_TRANSFER', amount: tb.data.total, reference: 'FT123' } });
  check('US-8 AC2', 'Thanh toán chuyển khoản', tp.status === 201 && tp.data.bill?.status === 'PAID', `HTTP ${tp.status}`);
  const stored = await prisma.payment.findFirst({ where: { billId: tb.data.id } });
  check('DoD B-04', 'Mã giao dịch không lưu dạng rõ', stored?.encryptedDetails && !stored.encryptedDetails.includes('FT123'));
  check('DoD B-04', 'Mật khẩu không lưu dạng rõ', !(await prisma.user.findMany({ select: { passwordHash: true } })).some((u) => u.passwordHash === PASSWORD));

  // ------------------------------------------------------------------ DoD B-06
  section('DoD B-06: gửi đồng thời');
  const C = await openQr(T5);
  await call('POST', `${C.S}/cart/items`, { body: { menuItemId: D1.id, quantity: 1 } });
  const dbl = await Promise.all([call('POST', `${C.S}/orders`, { body: {} }), call('POST', `${C.S}/orders`, { body: {} })]);
  check('DoD B-06', 'Gửi giỏ 2 lần cùng lúc chỉ tạo 1 đơn', (await prisma.order.count({ where: { sessionId: C.id } })) === 1, dbl.map((r) => r.status).join());
  await Promise.all([call('POST', '/bills', { token: waiter, body: { sessionId: C.id } }), call('POST', '/bills', { token: waiter, body: { sessionId: C.id } })]);
  const open = await prisma.bill.findMany({ where: { sessionId: C.id, status: 'OPEN' } });
  check('DoD B-06', 'Lập hóa đơn 2 lần cùng lúc chỉ có 1 hóa đơn', open.length === 1, `${open.length}`);
  await Promise.all([
    call('POST', `/bills/${open[0].id}/payments`, { token: waiter, body: { method: 'CASH', amount: open[0].total } }),
    call('POST', `/bills/${open[0].id}/payments`, { token: waiter, body: { method: 'CASH', amount: open[0].total } }),
  ]);
  check('DoD B-06', 'Thanh toán 2 lần cùng lúc chỉ thu 1 lần', (await prisma.payment.count({ where: { billId: open[0].id } })) === 1);

  // ------------------------------------------------------------------ US-12
  section('US-12: thời gian thực');
  for (const t of [T1, T4, T5]) await call('PATCH', `/tables/${t.id}/status`, { token: waiter, body: { status: 'AVAILABLE' } });
  const R = await openQr(T1);
  const kSock = await socketOf({ token: kitchen });
  const wSock = await socketOf({ token: waiter });
  const cSock = await socketOf({ sessionToken: R.token });
  const anon = await socketOf({});

  const seenByAnon = [];
  anon.on('order.created', () => seenByAnon.push('order.created'));
  anon.on('kitchen.order-received', () => seenByAnon.push('kitchen.order-received'));
  const kWait = waitEvent(kSock, 'kitchen.order-received');
  const wWait = waitEvent(wSock, 'order.created');
  const rOrder = await call('POST', `${R.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 1, note: 'Realtime' }] } });
  const [kGot, wGot] = await Promise.all([kWait, wWait]);
  check('US-12 AC1', 'Đơn mới tới bếp trong 5 giây', kGot && kGot.ms <= 5000, kGot ? `${kGot.ms} ms` : 'không nhận được');
  check('US-9 AC2', 'Phục vụ nhận đơn mới trong 5 giây', wGot && wGot.ms <= 5000, wGot ? `${wGot.ms} ms` : 'không nhận được');
  check('DoD B-02', 'Socket chưa đăng nhập không nhận sự kiện nội bộ', seenByAnon.length === 0, seenByAnon.join());

  const rid = rOrder.data.items[0].id;
  const cWait = waitEvent(cSock, 'order-item.updated', (p) => p.id === rid);
  const wWait2 = waitEvent(wSock, 'order-item.updated', (p) => p.id === rid);
  await call('PATCH', `/kitchen/items/${rid}/status`, { token: kitchen, body: { status: 'RECEIVED' } });
  const [cGot, wGot2] = await Promise.all([cWait, wWait2]);
  check('US-12 AC2', 'Trạng thái mới tới khách trong 5 giây', cGot && cGot.ms <= 5000 && cGot.payload.status === 'RECEIVED', cGot ? `${cGot.ms} ms` : 'không nhận được');
  check('US-12 AC2', 'Trạng thái mới tới phục vụ trong 5 giây', wGot2 && wGot2.ms <= 5000, wGot2 ? `${wGot2.ms} ms` : 'không nhận được');
  check('US-12 AC2', 'Sự kiện có thời gian thay đổi', !!cGot?.payload.updatedAt);

  const mWait = waitEvent(anon, 'menu.item-updated', (p) => p.id === D3.id && p.isAvailable === false);
  await call('PATCH', `/kitchen/menu-items/${D3.id}/availability`, { token: kitchen, body: { isAvailable: false } });
  const mGot = await mWait;
  check('DoD D-03', 'Hết món tới thực đơn khách trong 5 giây', mGot && mGot.ms <= 5000, mGot ? `${mGot.ms} ms` : 'không nhận được');
  await call('PATCH', `/kitchen/menu-items/${D3.id}/availability`, { token: kitchen, body: { isAvailable: true } });

  // US-12 AC4: mất kết nối rồi nối lại vẫn nhận tiếp sự kiện
  kSock.io.engine.close();
  await new Promise((resolve) => kSock.once('connect', resolve));
  await sleep(200);
  const kAgain = waitEvent(kSock, 'kitchen.order-received');
  await call('POST', `${R.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 1 }] } });
  const reGot = await kAgain;
  check('US-12 AC4', 'Nối lại socket vẫn nhận đơn mới', reGot && reGot.ms <= 5000, reGot ? `${reGot.ms} ms` : 'không nhận được');

  [kSock, wSock, cSock, anon].forEach((s) => s.close());

  // US-12 AC3, DoD E-02: 20 thiết bị thao tác đồng thời (mỗi thiết bị một IP giống thực tế sau proxy)
  section(`US-12 AC3: 20 thiết bị trong ${LOAD_SECONDS} giây`);
  const devices = await Promise.all(
    Array.from({ length: 20 }, (_, i) => socketOf(i % 3 === 0 ? { token: kitchen } : i % 3 === 1 ? { token: waiter } : { sessionToken: R.token })),
  );
  const latencies = [];
  let tooMany = 0;
  let failed = 0;
  const until = Date.now() + LOAD_SECONDS * 1000;
  const worker = async (i) => {
    const ip = `10.20.0.${i + 1}`;
    while (Date.now() < until) {
      const path = i % 3 === 0 ? '/kitchen/queue' : i % 3 === 1 ? '/tables/floor-plan' : '/public/menu';
      const token = i % 3 === 0 ? kitchen : i % 3 === 1 ? waiter : undefined;
      const t0 = Date.now();
      const r = await call('GET', path, { token, ip });
      latencies.push(Date.now() - t0);
      if (r.status === 429) tooMany++;
      else if (r.status >= 400) failed++;
      await sleep(700);
    }
  };
  const orderLatency = [];
  const kitchenDevice = devices[0];
  const orderWorker = async () => {
    while (Date.now() < until - 2000) {
      const w = waitEvent(kitchenDevice, 'kitchen.order-received');
      await call('POST', `${R.S}/orders`, { body: { items: [{ menuItemId: D1.id, quantity: 1 }] }, ip: '10.20.1.1' });
      const got = await w;
      orderLatency.push(got ? got.ms : Infinity);
      await sleep(1500);
    }
  };
  await Promise.all([...Array.from({ length: 20 }, (_, i) => worker(i)), orderWorker()]);
  devices.forEach((s) => s.close());
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];
  console.log(`  ${latencies.length} request, p95 ${p95} ms, chậm nhất ${max} ms, 429: ${tooMany}, lỗi khác: ${failed}; đơn tới bếp chậm nhất ${Math.max(...orderLatency)} ms`);
  check('US-12 AC3', 'Phản hồi trong 3 giây', max <= 3000, `chậm nhất ${max} ms`);
  check('US-12 AC3', 'Không thiết bị nào bị chặn vì hạn mức chung (429)', tooMany === 0, `${tooMany} request 429`);
  check('US-12 AC3', 'Không có lỗi khi tải cao', failed === 0, `${failed} lỗi`);
  check('DoD E-01', 'Đơn tới bếp trong 5 giây khi tải cao', Math.max(...orderLatency) <= 5000, `${Math.max(...orderLatency)} ms`);

}

run(main);
