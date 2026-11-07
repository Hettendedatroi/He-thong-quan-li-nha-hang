/**
 * Kiểm thử backend Sprint 1 theo Product Backlog: US-15, US-7, US-16, US-17, US-18, US-1.
 *
 * Yêu cầu: server đang chạy, DB vừa migrate + seed.
 *   BASE_URL=http://localhost:3000 npm run test:sprint1   (hoặc npm run test:e2e để chạy cả Sprint 1 + 2)
 *
 * Dữ liệu test tạo ra (món "Test S1", bàn "S1-TEST", tài khoản test_s1_*) được ẩn / khóa lại ở cuối,
 * thông tin nhà hàng được trả về như cũ, để chạy tiếp test Sprint 2 trên cùng DB.
 * Không chạy trên database thật / server dùng chung.
 */
import { existsSync, readFileSync } from 'fs';
import {
  PASSWORD,
  call,
  check,
  expectRejected,
  expectStatus,
  isFriendly,
  login,
  loginRaw,
  messageOf,
  prisma,
  run,
  section,
} from './helpers.mjs';

// Mỗi lần đăng nhập một IP riêng để không chạm giới hạn 10 lần / phút của test khác
let ipSeq = 0;
const nextIp = () => `10.51.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const signIn = (id, pw = PASSWORD) => login(id, pw, nextIp());
const signInRaw = (id, pw = PASSWORD) => loginRaw(id, pw, nextIp());

const publicItems = async () => (await call('GET', '/public/menu')).data.categories.flatMap((c) => c.items);
const uniq = Date.now().toString(36);

async function main() {
  section('Chuẩn bị');
  const manager = await signIn('manager');
  const waiter = await signIn('waiter1');
  const kitchen = await signIn('kitchen');
  if (!manager || !waiter || !kitchen) throw new Error('Không đăng nhập được tài khoản seed');

  // ------------------------------------------------------------------ US-15
  section('US-15: nền tảng dự án');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  check('US-15 AC1', 'README hướng dẫn chạy bằng một lệnh', !!pkg.scripts.quickstart && readme.includes('npm run quickstart'));
  check('US-15 AC2', 'Có script migration', existsSync(new URL('../prisma/migrations/migration_lock.toml', import.meta.url)));
  const models = ['user', 'diningTable', 'menuItem', 'order', 'reservation', 'dishReview', 'feedback'];
  const counts = await Promise.all(models.map((m) => prisma[m].count().then(() => true, () => false)));
  check('US-15 AC2', 'Lược đồ có người dùng, bàn, thực đơn, đơn hàng, đặt bàn, phản hồi', counts.every(Boolean), models.filter((_, i) => !counts[i]).join());
  const byRole = async (code) => prisma.user.count({ where: { role: { code }, NOT: { username: { startsWith: 'test_s1_' } } } });
  const seed = {
    manager: await byRole('MANAGER'),
    waiter: await byRole('WAITER'),
    kitchen: await byRole('KITCHEN'),
    dishes: await prisma.menuItem.count({ where: { isDeleted: false, NOT: { name: { startsWith: 'Test S1' } } } }),
    tables: await prisma.diningTable.count({ where: { NOT: { code: { startsWith: 'S1-' } } } }),
  };
  check('US-15 AC3', 'Dữ liệu mẫu: 1 quản lý, 2 phục vụ, 1 bếp, 10 món, 8 bàn',
    seed.manager === 1 && seed.waiter === 2 && seed.kitchen === 1 && seed.dishes === 10 && seed.tables === 8, JSON.stringify(seed));
  const health = await call('GET', '/health');
  check('US-15 AC4', 'Bản chạy thử phản hồi, kết nối được DB', health.status === 200 && health.data.db === 'ok', `HTTP ${health.status}`);

  // ------------------------------------------------------------------ US-7
  section('US-7: đăng nhập nhân viên');
  for (const [id, role] of [['manager', 'MANAGER'], ['waiter1', 'WAITER'], ['kitchen', 'KITCHEN']]) {
    const r = await signInRaw(id);
    check('US-7 AC1', `Đăng nhập ${id} trả về vai trò ${role}`, [200, 201].includes(r.status) && r.data.user?.role?.code === role && !r.data.user.passwordHash, `HTTP ${r.status}`);
  }
  const wrongPw = await signInRaw('waiter1', 'sai-mat-khau');
  const noUser = await signInRaw('khong-ton-tai', 'sai-mat-khau');
  expectRejected('US-7 AC1', 'Sai mật khẩu bị từ chối', wrongPw, 401);
  check('US-7 AC1', 'Sai tên đăng nhập và sai mật khẩu báo cùng một lỗi chung', noUser.status === 401 && messageOf(noUser) === messageOf(wrongPw), `${messageOf(noUser)} / ${messageOf(wrongPw)}`);
  expectRejected('US-7 AC2', 'Chưa đăng nhập: 401', await call('GET', '/tables/floor-plan'), 401);
  expectRejected('US-7 AC2', 'Phục vụ vào quản lý tài khoản: 403', await call('GET', '/admin/users', { token: waiter }), 403);
  expectRejected('US-7 AC2', 'Bếp vào hóa đơn: 403', await call('GET', '/bills', { token: kitchen }), 403);
  expectRejected('US-7 AC2', 'Phục vụ sửa thực đơn: 403', await call('POST', '/menu/items', { token: waiter, body: {} }), 403);
  const hashes = await prisma.user.findMany({ select: { passwordHash: true } });
  check('US-7 AC3', 'Mật khẩu lưu dạng băm bcrypt, không có mật khẩu dạng chữ', hashes.every((u) => !u.passwordHash || (/^\$2[aby]\$/.test(u.passwordHash) && u.passwordHash !== PASSWORD)));
  const session = (await signInRaw('waiter2')).data;
  expectStatus('US-7 AC4', 'Đăng xuất', await call('POST', '/auth/logout', { token: session.accessToken }), [200, 201]);
  expectStatus('US-7 AC4', 'Token cũ không dùng được sau khi đăng xuất', await call('GET', '/auth/me', { token: session.accessToken }), 401);
  expectStatus('US-7 AC4', 'Refresh token cũ không dùng được sau khi đăng xuất', await call('POST', '/auth/refresh', { body: { refreshToken: session.refreshToken } }), 401);

  // ------------------------------------------------------------------ US-16
  section('US-16: quản lý thực đơn');
  const categories = (await call('GET', '/menu/categories', { token: manager })).data;
  const [catA, catB] = categories;
  const newItem = { categoryId: catA.id, name: 'Test S1 Phở', description: 'Món test', price: 55000 };
  expectRejected('US-16 AC1', 'Thiếu tên món', await call('POST', '/menu/items', { token: manager, body: { ...newItem, name: undefined } }));
  expectRejected('US-16 AC1', 'Thiếu giá món', await call('POST', '/menu/items', { token: manager, body: { ...newItem, price: undefined } }));
  expectRejected('US-16 AC1', 'Giá món bằng 0', await call('POST', '/menu/items', { token: manager, body: { ...newItem, price: 0 } }));
  expectRejected('US-16 AC1', 'Giá món âm', await call('POST', '/menu/items', { token: manager, body: { ...newItem, price: -1000 } }));
  expectRejected('US-16 AC1', 'Thiếu danh mục', await call('POST', '/menu/items', { token: manager, body: { ...newItem, categoryId: undefined } }));
  expectRejected('US-16 AC1', 'Danh mục không tồn tại', await call('POST', '/menu/items', { token: manager, body: { ...newItem, categoryId: 999999 } }), [400, 404]);
  const created = await call('POST', '/menu/items', { token: manager, body: newItem });
  expectStatus('US-16 AC1', 'Thêm món đủ thông tin', created, 201);
  const itemId = created.data.id;
  const onMenu = (await publicItems()).find((i) => i.id === itemId);
  check('US-16 AC2', 'Món mới hiện trên thực đơn khách', onMenu?.name === newItem.name && onMenu?.price === newItem.price);

  await call('PATCH', `/menu/items/${itemId}`, { token: manager, body: { name: 'Test S1 Phở bò', price: 60000 } });
  const edited = (await publicItems()).find((i) => i.id === itemId);
  check('US-16 AC2', 'Sửa món cập nhật trên thực đơn khách', edited?.name === 'Test S1 Phở bò' && edited?.price === 60000);
  await call('PATCH', `/menu/items/${itemId}/visibility`, { token: manager, body: { isVisible: false } });
  check('US-16 AC2', 'Ẩn món thì gỡ khỏi thực đơn khách', !(await publicItems()).some((i) => i.id === itemId));
  await call('PATCH', `/menu/items/${itemId}/visibility`, { token: manager, body: { isVisible: true } });
  check('US-16 AC2', 'Hiện lại món', (await publicItems()).some((i) => i.id === itemId));

  const tables = (await call('GET', '/admin/tables?branchId=1', { token: manager })).data;
  const freeTable = tables.find((t) => t.isActive);
  await call('PATCH', `/menu/items/${itemId}/availability`, { token: manager, body: { isAvailable: false } });
  check('US-16 AC3', 'Món Hết hàng có nhãn trên thực đơn', (await publicItems()).find((i) => i.id === itemId)?.inStock === false);
  const qr = (await call('POST', `/public/tables/${freeTable.qrToken}/session`)).data;
  expectRejected('US-16 AC3', 'Món Hết hàng không thêm vào giỏ được', await call('POST', `/public/sessions/${qr.sessionToken}/cart/items`, { body: { menuItemId: itemId, quantity: 1 } }));
  expectRejected('US-16 AC3', 'Món Hết hàng không gọi trực tiếp được', await call('POST', `/public/sessions/${qr.sessionToken}/orders`, { body: { items: [{ menuItemId: itemId, quantity: 1 }] } }));
  await call('PATCH', `/menu/items/${itemId}/availability`, { token: manager, body: { isAvailable: true } });
  check('US-16 AC3', 'Đặt lại Còn hàng', (await publicItems()).find((i) => i.id === itemId)?.inStock === true);

  const filtered = (await call('GET', `/menu/items?categoryId=${catA.id}`, { token: manager })).data;
  const list = Array.isArray(filtered) ? filtered : filtered.items;
  check('US-16 AC4', 'Lọc món theo danh mục', list.length > 0 && list.every((i) => i.categoryId === catA.id) && list.some((i) => i.id === itemId));
  const filteredB = (await call('GET', `/menu/items?categoryId=${catB.id}`, { token: manager })).data;
  check('US-16 AC4', 'Danh mục khác không lẫn món', !(Array.isArray(filteredB) ? filteredB : filteredB.items).some((i) => i.id === itemId));

  expectStatus('US-16 AC2', 'Xóa món', await call('DELETE', `/menu/items/${itemId}`, { token: manager }), 200);
  check('US-16 AC2', 'Món đã xóa biến khỏi thực đơn khách', !(await publicItems()).some((i) => i.id === itemId));
  const cat = await call('POST', '/menu/categories', { token: manager, body: { name: `Test S1 danh mục ${uniq}` } });
  expectStatus('US-16', 'Thêm danh mục', cat, 201);
  expectRejected('US-16 AC1', 'Danh mục thiếu tên', await call('POST', '/menu/categories', { token: manager, body: {} }));
  await call('PATCH', `/menu/categories/${cat.data.id}`, { token: manager, body: { name: `Test S1 danh mục sửa ${uniq}` } });
  expectStatus('US-16', 'Xóa danh mục trống', await call('DELETE', `/menu/categories/${cat.data.id}`, { token: manager }), 200);

  // ------------------------------------------------------------------ US-17
  section('US-17: thông tin nhà hàng, bàn và QR');
  const zone = (await call('GET', '/admin/zones?branchId=1', { token: manager })).data[0];
  const code = `S1-${uniq}`.toUpperCase();
  expectRejected('US-17 AC1', 'Số chỗ 0 bị từ chối', await call('POST', '/admin/tables', { token: manager, body: { zoneId: zone.id, code, capacity: 0 } }));
  expectRejected('US-17 AC1', 'Thiếu số bàn bị từ chối', await call('POST', '/admin/tables', { token: manager, body: { zoneId: zone.id, capacity: 4 } }));
  const table = await call('POST', '/admin/tables', { token: manager, body: { zoneId: zone.id, code, capacity: 4 } });
  expectStatus('US-17 AC1', 'Thêm bàn', table, 201);
  const dup = await call('POST', '/admin/tables', { token: manager, body: { zoneId: zone.id, code, capacity: 2 } });
  expectRejected('US-17 AC1', 'Số bàn trùng bị từ chối', dup, 409);
  check('US-17 AC1', 'Lỗi trùng số bàn nói rõ là số bàn', /số bàn|mã bàn/i.test(messageOf(dup)), messageOf(dup));
  const other = tables.find((t) => t.code !== code);
  expectRejected('US-17 AC1', 'Sửa thành số bàn đã có bị từ chối', await call('PATCH', `/admin/tables/${table.data.id}`, { token: manager, body: { code: other.code } }), 409);
  const upd = await call('PATCH', `/admin/tables/${table.data.id}`, { token: manager, body: { capacity: 6 } });
  check('US-17 AC1', 'Sửa số chỗ', upd.status === 200 && upd.data.capacity === 6, `HTTP ${upd.status}`);
  expectRejected('US-17 AC1', 'Sửa số chỗ về 0 bị từ chối', await call('PATCH', `/admin/tables/${table.data.id}`, { token: manager, body: { capacity: 0 } }));

  const qrInfo = (await call('GET', `/admin/tables/${table.data.id}/qr`, { token: manager })).data;
  const qrUrl = new URL(qrInfo.url);
  check('US-17 AC2', 'QR mở trang thực đơn kèm mã bàn', qrUrl.pathname === '/menu' && qrUrl.searchParams.get('table') === qrInfo.qrToken, qrInfo.url);
  check('US-17 AC2', 'QR tải xuống được (ảnh PNG)', /^data:image\/png;base64,/.test(qrInfo.qrDataUrl ?? ''));
  const allTokens = (await call('GET', '/admin/tables?branchId=1', { token: manager })).data.map((t) => t.qrToken);
  check('US-17 AC2', 'Mỗi bàn một mã QR riêng', new Set(allTokens).size === allTokens.length);
  const scan = await call('POST', `/public/tables/${qrUrl.searchParams.get('table')}/session`);
  check('US-17 AC2', 'Quét QR mở đúng bàn đó', scan.status === 201 && scan.data.table?.code === code, `HTTP ${scan.status}`);
  const regen = (await call('POST', `/admin/tables/${table.data.id}/regenerate-qr`, { token: manager })).data;
  check('US-17 AC2', 'Tạo lại QR ra mã mới', regen.qrToken && regen.qrToken !== qrInfo.qrToken);
  expectRejected('US-17 AC2', 'Mã QR cũ hết hiệu lực', await call('POST', `/public/tables/${qrInfo.qrToken}/session`), 404);

  const oldInfo = (await call('GET', '/admin/settings/restaurant', { token: manager })).data;
  const oldBranch = (await call('GET', '/admin/branches', { token: manager })).data.find((b) => b.id === 1);
  await call('PUT', '/admin/settings/restaurant', { token: manager, body: { value: { ...oldInfo, name: 'Nhà hàng Test S1' } } });
  const branchEdit = await call('PATCH', '/admin/branches/1', { token: manager, body: { address: '1 Đường Test S1', openTime: '08:00', closeTime: '22:30' } });
  expectStatus('US-17 AC3', 'Sửa địa chỉ, giờ mở cửa', branchEdit, 200);
  expectRejected('US-17 AC3', 'Giờ mở cửa sai định dạng', await call('PATCH', '/admin/branches/1', { token: manager, body: { openTime: '25:99' } }));
  const shown = (await call('GET', '/public/menu')).data.restaurant;
  check('US-17 AC3', 'Tên, địa chỉ, giờ mở cửa hiện trên trang thực đơn',
    shown?.name === 'Nhà hàng Test S1' && shown?.address === '1 Đường Test S1' && shown?.openTime === '08:00' && shown?.closeTime === '22:30', JSON.stringify(shown));
  await call('PUT', '/admin/settings/restaurant', { token: manager, body: { value: oldInfo } });
  await call('PATCH', '/admin/branches/1', { token: manager, body: { address: oldBranch.address, openTime: oldBranch.openTime, closeTime: oldBranch.closeTime } });

  const sold = (await publicItems()).find((i) => i.inStock);
  await call('POST', `/public/sessions/${scan.data.sessionToken}/orders`, { body: { items: [{ menuItemId: sold.id, quantity: 1 }] } });
  expectRejected('US-17 AC4', 'Bàn có đơn chưa thanh toán không xóa được', await call('DELETE', `/admin/tables/${table.data.id}`, { token: manager }), 409);
  const spare = await call('POST', '/admin/tables', { token: manager, body: { zoneId: zone.id, code: `${code}-B`, capacity: 2 } });
  expectStatus('US-17 AC1', 'Xóa bàn chưa dùng', await call('DELETE', `/admin/tables/${spare.data.id}`, { token: manager }), 200);
  expectRejected('US-17 AC1', 'Phục vụ không thêm bàn được', await call('POST', '/admin/tables', { token: waiter, body: { zoneId: zone.id, code: 'X', capacity: 2 } }), 403);
  // Dọn: bàn test có đơn thì tắt đi để không lẫn vào test Sprint 2
  await call('PATCH', `/admin/tables/${table.data.id}`, { token: manager, body: { isActive: false } });

  // ------------------------------------------------------------------ US-18
  section('US-18: tài khoản nhân viên');
  const username = `test_s1_${uniq}`;
  const staff = { fullName: 'Nhân viên Test S1', username, roleCode: 'WAITER', password: 'Matkhau@123' };
  for (const field of ['fullName', 'username', 'roleCode', 'password']) {
    const r = await call('POST', '/admin/users', { token: manager, body: { ...staff, [field]: undefined } });
    expectRejected('US-18 AC1', `Thiếu ${field}`, r);
  }
  expectRejected('US-18 AC1', 'Mật khẩu ban đầu quá ngắn', await call('POST', '/admin/users', { token: manager, body: { ...staff, password: '123' } }));
  const badName = await call('POST', '/admin/users', { token: manager, body: { ...staff, username: 'tên có dấu' } });
  expectRejected('US-18 AC1', 'Tên đăng nhập có dấu / khoảng trắng', badName);
  check('US-18 AC1', 'Câu báo lỗi không nói "chỉ chữ thường" (server tự đổi chữ hoa)', !/chữ thường/.test(messageOf(badName)), messageOf(badName));
  expectRejected('US-18 AC1', 'Vai trò không tồn tại', await call('POST', '/admin/users', { token: manager, body: { ...staff, roleCode: 'KHONG_CO' } }), [400, 404]);
  const createdUser = await call('POST', '/admin/users', { token: manager, body: { ...staff, username: username.toUpperCase() } });
  expectStatus('US-18 AC1', 'Tạo tài khoản (tên đăng nhập viết hoa được đổi thành chữ thường)', createdUser, 201);
  check('US-18 AC1', 'Tên đăng nhập lưu chữ thường', createdUser.data.username === username, createdUser.data.username);
  for (const roleCode of ['KITCHEN', 'MANAGER']) {
    const r = await call('POST', '/admin/users', { token: manager, body: { ...staff, username: `${username}_${roleCode.toLowerCase()}`, roleCode } });
    check('US-18 AC1', `Quản lý tạo được tài khoản ${roleCode}`, r.status === 201 && r.data.role?.code === roleCode, `HTTP ${r.status} ${messageOf(r)}`);
    if (r.status === 201) await call('POST', `/admin/users/${r.data.id}/lock`, { token: manager, body: { reason: 'Dọn dữ liệu test' } });
  }
  expectRejected('US-18', 'Quản lý không tạo được tài khoản quản trị (quyền cao hơn)', await call('POST', '/admin/users', { token: manager, body: { ...staff, username: `${username}_admin`, roleCode: 'ADMIN' } }), 403);
  const dupUser = await call('POST', '/admin/users', { token: manager, body: staff });
  expectRejected('US-18 AC1', 'Tên đăng nhập trùng bị từ chối', dupUser, 409);
  check('US-18 AC1', 'Lỗi trùng nói rõ tên đăng nhập', /tên đăng nhập/i.test(messageOf(dupUser)), messageOf(dupUser));
  const uid = createdUser.data.id;
  check('US-18 AC1', 'Nhân viên mới đăng nhập được', !!(await signIn(username, staff.password)));

  const staffList = (await call('GET', '/admin/users?staffOnly=true&limit=100', { token: manager })).data.items;
  check('US-18', 'Lọc chỉ tài khoản nhân viên', staffList.length > 0 && staffList.every((u) => u.role.code !== 'CUSTOMER') && staffList.some((u) => u.id === uid));
  const everyone = (await call('GET', '/admin/users?limit=100', { token: manager })).data.items;
  check('US-18', 'Không truyền staffOnly vẫn trả đủ như cũ', everyone.some((u) => u.role.code === 'CUSTOMER'));
  const notStaff = (await call('GET', '/admin/users?staffOnly=false&limit=100', { token: manager })).data.items;
  check('US-18', 'staffOnly=false không lọc', notStaff.length === everyone.length);

  const editUser = await call('PATCH', `/admin/users/${uid}`, { token: manager, body: { fullName: 'Nhân viên Test S1 sửa', roleCode: 'KITCHEN' } });
  check('US-18', 'Sửa họ tên và vai trò', editUser.status === 200 && editUser.data.role?.code === 'KITCHEN', `HTTP ${editUser.status}`);

  const staffToken = await signIn(username, staff.password);
  expectStatus('US-18 AC2', 'Khóa tài khoản', await call('POST', `/admin/users/${uid}/lock`, { token: manager, body: { reason: 'Test' } }), [200, 201]);
  expectRejected('US-18 AC2', 'Tài khoản bị khóa không đăng nhập được', await signInRaw(username, staff.password), 403);
  expectStatus('US-18 AC2', 'Phiên đang mở của tài khoản bị khóa bị chặn', await call('GET', '/auth/me', { token: staffToken }), [401, 403]);
  expectStatus('US-18 AC2', 'Mở khóa', await call('POST', `/admin/users/${uid}/unlock`, { token: manager }), [200, 201]);
  check('US-18 AC2', 'Mở khóa thì đăng nhập lại được', !!(await signIn(username, staff.password)));

  expectStatus('US-18 AC3', 'Đặt lại mật khẩu', await call('POST', `/admin/users/${uid}/reset-password`, { token: manager, body: { newPassword: 'Moi@12345' } }), [200, 201]);
  check('US-18 AC3', 'Đăng nhập bằng mật khẩu mới', !!(await signIn(username, 'Moi@12345')));
  expectStatus('US-18 AC3', 'Mật khẩu cũ hết hiệu lực', await signInRaw(username, staff.password), 401);
  const temp = await call('POST', `/admin/users/${uid}/reset-password`, { token: manager, body: {} });
  check('US-18 AC3', 'Bỏ trống thì hệ thống sinh mật khẩu tạm', !!temp.data.temporaryPassword && !!(await signIn(username, temp.data.temporaryPassword)));

  const me = (await call('GET', '/auth/me', { token: manager })).data;
  expectRejected('US-18 AC4', 'Quản lý không tự khóa mình', await call('POST', `/admin/users/${me.id}/lock`, { token: manager, body: {} }));
  expectRejected('US-18 AC4', 'Quản lý không tự đổi vai trò', await call('PATCH', `/admin/users/${me.id}`, { token: manager, body: { roleCode: 'WAITER' } }));
  expectStatus('US-18 AC4', 'Không có API xóa tài khoản (chỉ khóa)', await call('DELETE', `/admin/users/${me.id}`, { token: manager }), 404);
  expectRejected('US-18', 'Phục vụ không tạo tài khoản được', await call('POST', '/admin/users', { token: waiter, body: staff }), 403);
  await call('POST', `/admin/users/${uid}/lock`, { token: manager, body: { reason: 'Dọn dữ liệu test' } });

  // ------------------------------------------------------------------ US-1
  section('US-1: khách quét QR xem thực đơn');
  const t1 = tables.find((t) => t.isActive);
  const t1Qr = (await call('GET', `/admin/tables/${t1.id}/qr`, { token: manager })).data;
  const opened = await call('POST', `/public/tables/${new URL(t1Qr.url).searchParams.get('table')}/session`);
  check('US-1 AC1', 'Quét QR hiển thị số bàn', opened.status === 201 && opened.data.table?.code === t1.code, `HTTP ${opened.status}`);
  expectRejected('US-1 AC1', 'QR không hợp lệ báo lỗi thân thiện', await call('POST', '/public/tables/khong-ton-tai/session'), 404);
  const t0 = Date.now();
  const menu = await call('GET', '/public/menu');
  const ms = Date.now() - t0;
  const cats = menu.data.categories ?? [];
  const dishes = cats.flatMap((c) => c.items);
  check('US-1 AC2', 'Món nhóm theo danh mục', cats.length > 0 && cats.every((c) => c.name && Array.isArray(c.items)));
  check('US-1 AC2', 'Món có hình ảnh, mô tả, giá, tình trạng',
    dishes.length > 0 && dishes.every((i) => 'imageUrl' in i && 'description' in i && i.price > 0 && typeof i.inStock === 'boolean'));
  check('US-1 AC2', 'Chỉ hiện món đang bán (không có món ẩn / đã xóa)', !dishes.some((i) => i.name.startsWith('Test S1')));
  check('US-1 AC4', 'API thực đơn phản hồi dưới 3 giây (phía server)', ms < 3000, `${ms} ms`);
}

run(main);
