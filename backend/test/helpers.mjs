/**
 * Hàm dùng chung cho các bài kiểm thử theo sprint (test/sprintN.e2e.mjs).
 * Mỗi kiểm tra ghi rõ AC / DoD để đối chiếu vào bảng AC - Test case (DoD A-01, F-03).
 */
import prismaPkg from '@prisma/client';

export const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const API = `${BASE}/api`;
export const PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';
export const prisma = new prismaPkg.PrismaClient();

const results = [];
export const check = (ref, title, ok, detail = '') => {
  results.push({ ref, title, ok: !!ok, detail });
  if (!ok) console.log(`  FAIL [${ref}] ${title}${detail ? ` -> ${detail}` : ''}`);
};
export const section = (s) => console.log(`== ${s}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `ip` gửi kèm X-Forwarded-For để giả lập nhiều thiết bị (server tin 1 proxy theo mặc định) */
export async function call(method, path, { token, body, ip } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

export const expectStatus = (ref, title, r, status) =>
  check(ref, title, [status].flat().includes(r.status), `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 180)}`);
export const messageOf = (r) => [r.data?.message].flat().join('; ');
/** DoD A-04: thông báo thân thiện, tiếng Việt - không phải câu mặc định của class-validator */
export const isFriendly = (r) => {
  const m = messageOf(r);
  return !!m && !/\b(must|should|property|Validation failed|Bad Request|Forbidden|Unauthorized)\b/i.test(m);
};
export const expectRejected = (ref, title, r, status = 400) => {
  expectStatus(ref, title, r, status);
  check('DoD A-04', `Thông báo dễ hiểu: ${title}`, isFriendly(r), messageOf(r));
};

export const loginRaw = (identifier, password = PASSWORD, ip) =>
  call('POST', '/auth/login', { body: { identifier, password }, ip });
export const login = async (identifier, password = PASSWORD, ip) => (await loginRaw(identifier, password, ip)).data?.accessToken;

export async function finish() {
  const failed = results.filter((r) => !r.ok);
  const byRef = new Map();
  for (const r of results) {
    const cur = byRef.get(r.ref) ?? { pass: 0, fail: 0 };
    r.ok ? cur.pass++ : cur.fail++;
    byRef.set(r.ref, cur);
  }
  console.log('\nKết quả theo AC / DoD:');
  for (const [ref, c] of [...byRef].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${c.fail ? 'FAIL' : 'PASS'}  ${ref.padEnd(12)} ${c.pass}/${c.pass + c.fail}`);
  }
  console.log(`\nTỔNG: ${results.length - failed.length}/${results.length} đạt, ${failed.length} lỗi`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

export function run(main) {
  main()
    .then(finish)
    .catch(async (err) => {
      console.error('Test dừng giữa chừng:', err);
      await finish().catch(() => process.exit(1));
      process.exit(1);
    });
}
