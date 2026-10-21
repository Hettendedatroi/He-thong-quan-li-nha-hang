/**
 * Dữ liệu mẫu để chạy thử: npm run db:seed
 * Có thể chạy nhiều lần (upsert), không nhân đôi dữ liệu.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DEFAULT_ROLES } from '../src/common/constants/permissions';

const prisma = new PrismaClient();
const token = () => randomBytes(18).toString('base64url');

async function main() {
  // ---------------------------------------------------------------- Vai trò
  for (const r of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      create: { ...r, isSystem: true },
      update: { name: r.name, description: r.description, permissions: r.permissions, isSystem: true },
    });
  }
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.code, r.id]));

  // ---------------------------------------------------------------- Chi nhánh
  const branch1 = await prisma.branch.upsert({
    where: { id: 1 },
    create: { name: 'Chi nhánh Quận 1', address: '12 Nguyễn Huệ, Quận 1, TP.HCM', phone: '028 3822 0001', openTime: '09:00', closeTime: '22:30' },
    update: {},
  });
  const branch2 = await prisma.branch.upsert({
    where: { id: 2 },
    create: { name: 'Chi nhánh Cầu Giấy', address: '88 Trần Thái Tông, Cầu Giấy, Hà Nội', phone: '024 3795 0002', openTime: '10:00', closeTime: '22:00' },
    update: {},
  });

  // ---------------------------------------------------------------- Tài khoản mẫu
  const password = await bcrypt.hash('Password@123', 10);
  const users = [
    { email: 'admin@restaurant.local', phone: '0900000001', fullName: 'Quản trị viên', role: 'ADMIN', branchId: null },
    { email: 'manager@restaurant.local', phone: '0900000002', fullName: 'Nguyễn Quản Lý', role: 'MANAGER', branchId: branch1.id },
    { email: 'leader@restaurant.local', phone: '0900000003', fullName: 'Trần Trưởng Ca', role: 'SENIOR_WAITER', branchId: branch1.id },
    { email: 'waiter@restaurant.local', phone: '0900000004', fullName: 'Lê Phục Vụ', role: 'WAITER', branchId: branch1.id },
    { email: 'kitchen@restaurant.local', phone: '0900000005', fullName: 'Phạm Đầu Bếp', role: 'KITCHEN', branchId: branch1.id },
    { email: 'customer@example.com', phone: '0911111111', fullName: 'Khách Hàng Mẫu', role: 'CUSTOMER', branchId: null },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        phone: u.phone,
        fullName: u.fullName,
        passwordHash: password,
        roleId: roles[u.role],
        branchId: u.branchId,
        loyaltyPoints: u.role === 'CUSTOMER' ? 50 : 0,
      },
      update: { roleId: roles[u.role], branchId: u.branchId },
    });
  }

  // ---------------------------------------------------------------- Khu vực & bàn
  const zoneDefs = [
    { name: 'Trong nhà', locationType: 'INDOOR', prefix: 'A', tables: [2, 2, 4, 4, 4, 6] },
    { name: 'Ngoài trời', locationType: 'OUTDOOR', prefix: 'B', tables: [2, 4, 4, 6] },
    { name: 'Phòng VIP', locationType: 'VIP', prefix: 'V', tables: [8, 12] },
  ];
  for (const branch of [branch1, branch2]) {
    for (const [zi, z] of zoneDefs.entries()) {
      const zone = await prisma.zone.upsert({
        where: { branchId_name: { branchId: branch.id, name: z.name } },
        create: { branchId: branch.id, name: z.name, locationType: z.locationType, sortOrder: zi },
        update: {},
      });
      for (const [ti, capacity] of z.tables.entries()) {
        const code = `${z.prefix}${String(ti + 1).padStart(2, '0')}`;
        await prisma.diningTable.upsert({
          where: { branchId_code: { branchId: branch.id, code } },
          create: { branchId: branch.id, zoneId: zone.id, code, capacity, qrToken: token(), posX: ti * 120, posY: zi * 160 },
          update: {},
        });
      }
    }
  }

  // ---------------------------------------------------------------- Thực đơn
  const categories = [
    { name: 'Khai vị', en: 'Appetizers', items: [
      { name: 'Gỏi cuốn tôm thịt', en: 'Fresh spring rolls', price: 65000, prep: 8, tags: ['healthy'] },
      { name: 'Chả giò rế', en: 'Crispy fried rolls', price: 75000, prep: 12, tags: [] },
      { name: 'Súp cua', en: 'Crab soup', price: 55000, prep: 10, tags: [] },
    ] },
    { name: 'Món chính', en: 'Main courses', items: [
      { name: 'Bò lúc lắc', en: 'Shaking beef', price: 185000, prep: 15, tags: ['best-seller'] },
      { name: 'Cá kho tộ', en: 'Caramelized fish in clay pot', price: 145000, prep: 20, tags: [] },
      { name: 'Cơm chiên hải sản', en: 'Seafood fried rice', price: 120000, prep: 12, tags: [] },
      { name: 'Lẩu thái hải sản', en: 'Thai seafood hotpot', price: 390000, prep: 20, tags: ['spicy', 'sharing'] },
      { name: 'Đậu hũ sốt nấm', en: 'Tofu with mushroom sauce', price: 85000, prep: 10, tags: ['vegetarian'] },
    ] },
    { name: 'Tráng miệng', en: 'Desserts', items: [
      { name: 'Chè khúc bạch', en: 'Khuc bach sweet soup', price: 45000, prep: 5, tags: [] },
      { name: 'Bánh flan', en: 'Caramel flan', price: 35000, prep: 3, tags: [] },
    ] },
    { name: 'Đồ uống', en: 'Beverages', items: [
      { name: 'Trà đào cam sả', en: 'Peach lemongrass tea', price: 49000, prep: 4, tags: [] },
      { name: 'Cà phê sữa đá', en: 'Iced milk coffee', price: 39000, prep: 3, tags: [] },
      { name: 'Nước ép cam', en: 'Orange juice', price: 45000, prep: 4, tags: ['healthy'] },
      { name: 'Bia Sài Gòn', en: 'Saigon beer', price: 30000, prep: 1, tags: [] },
    ] },
  ];
  const itemIds: Record<string, number> = {};
  let drinksCategoryId = 0;
  for (const [ci, c] of categories.entries()) {
    let cat = await prisma.menuCategory.findFirst({ where: { name: c.name } });
    if (!cat) {
      cat = await prisma.menuCategory.create({
        data: { name: c.name, sortOrder: ci, translations: { en: { name: c.en } } },
      });
    }
    if (c.name === 'Đồ uống') drinksCategoryId = cat.id;
    for (const it of c.items) {
      let item = await prisma.menuItem.findFirst({ where: { name: it.name } });
      if (!item) {
        item = await prisma.menuItem.create({
          data: {
            categoryId: cat.id,
            name: it.name,
            description: `${it.name} - món ngon của nhà hàng`,
            price: it.price,
            prepTimeMinutes: it.prep,
            tags: it.tags,
            translations: { en: { name: it.en } },
          },
        });
      }
      itemIds[it.name] = item.id;
    }
  }

  // Giá cuối tuần cho lẩu (FR-MGR-10)
  const hotpot = itemIds['Lẩu thái hải sản'];
  if (!(await prisma.priceRule.findFirst({ where: { menuItemId: hotpot } }))) {
    await prisma.priceRule.create({ data: { menuItemId: hotpot, name: 'Giá cuối tuần', dayType: 'WEEKEND', price: 420000 } });
    await prisma.priceRule.create({ data: { menuItemId: hotpot, name: 'Giá ngày lễ', dayType: 'HOLIDAY', price: 450000 } });
  }
  for (const h of [
    { date: '2026-01-01', name: 'Tết Dương lịch' },
    { date: '2026-04-30', name: 'Giải phóng miền Nam' },
    { date: '2026-05-01', name: 'Quốc tế Lao động' },
    { date: '2026-09-02', name: 'Quốc khánh' },
  ]) {
    await prisma.holiday.upsert({
      where: { date: new Date(`${h.date}T00:00:00.000Z`) },
      create: { date: new Date(`${h.date}T00:00:00.000Z`), name: h.name },
      update: {},
    });
  }

  // Combo (FR-MGR-09)
  if (!(await prisma.combo.findFirst({ where: { name: 'Combo gia đình 4 người' } }))) {
    await prisma.combo.create({
      data: {
        name: 'Combo gia đình 4 người',
        description: 'Gỏi cuốn + Bò lúc lắc + Cá kho tộ + 4 trà đào',
        price: 520000,
        items: {
          create: [
            { menuItemId: itemIds['Gỏi cuốn tôm thịt'], quantity: 1 },
            { menuItemId: itemIds['Bò lúc lắc'], quantity: 1 },
            { menuItemId: itemIds['Cá kho tộ'], quantity: 1 },
            { menuItemId: itemIds['Trà đào cam sả'], quantity: 4 },
          ],
        },
      },
    });
  }

  // Khuyến mãi: happy hour đồ uống 17h-19h & voucher chào mừng
  const yearStart = new Date('2026-01-01T00:00:00+07:00');
  const yearEnd = new Date('2027-12-31T23:59:59+07:00');
  if (!(await prisma.promotion.findFirst({ where: { name: 'Happy hour đồ uống' } }))) {
    await prisma.promotion.create({
      data: {
        name: 'Happy hour đồ uống',
        description: 'Giảm 20% đồ uống từ 17:00 đến 19:00 các ngày trong tuần',
        type: 'PERCENT',
        value: 20,
        scope: 'CATEGORY',
        categoryIds: [drinksCategoryId],
        startAt: yearStart,
        endAt: yearEnd,
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '17:00',
        endTime: '19:00',
      },
    });
  }
  await prisma.promotion.upsert({
    where: { code: 'WELCOME10' },
    create: {
      code: 'WELCOME10',
      name: 'Chào mừng khách mới',
      description: 'Giảm 10% tối đa 100.000đ cho hóa đơn từ 300.000đ',
      type: 'PERCENT',
      value: 10,
      maxDiscount: 100000,
      minOrderAmount: 300000,
      startAt: yearStart,
      endAt: yearEnd,
    },
    update: {},
  });

  // Thiết bị mẫu (FR-ADM-11)
  if (!(await prisma.device.findFirst({ where: { name: 'KDS bếp chính' } }))) {
    await prisma.device.create({ data: { branchId: branch1.id, name: 'KDS bếp chính', type: 'KDS', deviceKey: 'dev_kds_demo_branch1' } });
    await prisma.device.create({ data: { branchId: branch1.id, name: 'Máy in bếp', type: 'PRINTER', deviceKey: 'dev_printer_demo_branch1' } });
  }

  // Ca làm hôm nay cho chi nhánh 1 (FR-MGR-17)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const shiftDefs = [
    { name: 'Ca sáng', start: '09:00', end: '15:00' },
    { name: 'Ca tối', start: '15:00', end: '22:30' },
  ];
  const staff = await prisma.user.findMany({ where: { branchId: branch1.id } });
  for (const s of shiftDefs) {
    const startAt = new Date(`${today}T${s.start}:00+07:00`);
    if (await prisma.shift.findFirst({ where: { branchId: branch1.id, startAt } })) continue;
    await prisma.shift.create({
      data: {
        branchId: branch1.id,
        name: s.name,
        startAt,
        endAt: new Date(`${today}T${s.end}:00+07:00`),
        assignments: { create: staff.map((u) => ({ userId: u.id })) },
      },
    });
  }

  console.log('Seed xong. Tài khoản mẫu (mật khẩu: Password@123):');
  for (const u of users) console.log(`  - ${u.role.padEnd(14)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
