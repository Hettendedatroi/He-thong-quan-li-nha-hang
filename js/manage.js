(() => {
  const API = ["localhost:5173", "127.0.0.1:5173"].includes(location.host)
      ? "http://127.0.0.1:3000/api"
      : "/api",
    $ = (s, p = document) => p.querySelector(s),
    $$ = (s, p = document) => [...p.querySelectorAll(s)],
    app = $("#app"),
    dlg = $("#login");
  let token = localStorage.getItem("bn_access"),
    me = null,
    realtimeSocket = null,
    realtimeLoader = null,
    userRows = [],
    branchRows = null,
    menuRows = [],
    categoryRows = [];
  const responseCache = new Map(),
    CACHE_MS = 15000;
  const roleNames = {
    MANAGER: "Quản lý nhà hàng",
    SENIOR_WAITER: "Trưởng ca",
    WAITER: "Phục vụ",
    KITCHEN: "Nhân viên bếp",
  };
  const roleHome = {
    ADMIN: "dashboard",
    MANAGER: "dashboard",
    SENIOR_WAITER: "table-map",
    WAITER: "table-map",
    KITCHEN: "kitchen",
  };
  const rolePages = {
    ADMIN: [
      "dashboard",
      "table-map",
      "reservations",
      "orders",
      "kitchen",
      "menu",
      "customers",
    ],
    MANAGER: [
      "dashboard",
      "table-map",
      "reservations",
      "orders",
      "kitchen",
      "menu",
      "customers",
    ],
    SENIOR_WAITER: ["table-map", "reservations", "orders"],
    WAITER: ["table-map", "reservations", "orders"],
    KITCHEN: ["kitchen", "orders"],
  };
  const statusNames = {
    PENDING: "Chờ xác nhận",
    CONFIRMED: "Đã xác nhận",
    CHECKED_IN: "Đã nhận khách",
    COMPLETED: "Hoàn tất",
    CANCELLED: "Đã hủy",
    REJECTED: "Đã từ chối",
    NO_SHOW: "Khách không đến",
    PENDING_CONFIRM: "Chờ nhân viên",
    SENT_TO_KITCHEN: "Đã gửi bếp",
    PREPARING: "Đang chế biến",
    READY: "Sẵn sàng",
    SERVED: "Đã phục vụ",
  };
  const esc = (s) =>
    String(s ?? "—").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const money = (n) => `${Number(n || 0).toLocaleString("vi-VN")} ₫`;
  const statusName = (s) => statusNames[s] || s || "—";
  const toast = (s) => {
    const t = $("#toast");
    t.textContent = s;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  };
  function connectRealtime() {
    if (!token) return;
    const connect = () => {
      if (!window.io) return;
      realtimeSocket?.disconnect();
      realtimeSocket = window.io(API.slice(0, -4), { auth: { token } });
      const refreshReservations = () => {
        if (["#table-map", "#reservations"].includes(location.hash)) {
          responseCache.clear();
          load();
        }
      };
      realtimeSocket.on("reservation.created", refreshReservations);
      realtimeSocket.on("reservation.updated", refreshReservations);
    };
    if (window.io) return connect();
    if (!realtimeLoader) {
      realtimeLoader = document.createElement("script");
      realtimeLoader.src = API.slice(0, -4) + "/socket.io/socket.io.js";
      realtimeLoader.onload = connect;
      document.head.appendChild(realtimeLoader);
    }
  }
  async function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase(),
      key = `${method}:${path}`;
    if (method === "GET") {
      const cached = responseCache.get(key);
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
    }
    const request = {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    };
    let res, lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 10000);
      try {
        res = await fetch(API + path, {
          ...request,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (![502, 503, 504].includes(res.status) || attempt === 2) break;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt === 2)
          throw Error("Không thể kết nối máy chủ. Vui lòng thử lại sau.");
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (!res) {
      throw (
        lastError || Error("Không thể kết nối máy chủ. Vui lòng thử lại sau.")
      );
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        token = null;
        responseCache.clear();
        localStorage.removeItem("bn_access");
        dlg.showModal();
      }
      throw Error(
        res.status >= 502
          ? "Máy chủ đang khởi động hoặc tạm thời quá tải. Vui lòng bấm Làm mới sau ít giây."
          : res.status === 403
            ? "Truy cập bị từ chối"
            : body?.message || `Yêu cầu API thất bại (${res.status})`,
      );
    }
    if (method === "GET") responseCache.set(key, { body, at: Date.now() });
    else responseCache.clear();
    return body;
  }
  const query = (obj = {}) => {
    const p = new URLSearchParams(obj);
    return p.size ? `?${p}` : "";
  };
  function table(headers, rows) {
    return `<div class="panel"><table><thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows || ""}</tbody></table>${!rows ? '<div class="empty">Chưa có dữ liệu</div>' : ""}</div>`;
  }
  function act(label, path, method = "POST", body = {}) {
    return `<button class="action" data-act="${esc(path)}" data-method="${method}" data-body='${esc(JSON.stringify(body))}'>${esc(label)}</button>`;
  }
  async function load() {
    if (!token) {
      dlg.showModal();
      return;
    }
    const role = me?.role?.code || me?.roleCode;
    const requestedPage =
      location.hash.slice(1) || roleHome[role] || "dashboard";
    const allowedPages = rolePages[role] || [];
    const page = allowedPages.includes(requestedPage)
      ? requestedPage
      : "forbidden";
    const names = {
      dashboard: "Tổng quan",
      "table-map": "Sơ đồ bàn",
      reservations: "Đặt bàn",
      orders: "Đơn hàng",
      kitchen: "Bếp",
      menu: "Thực đơn",
      customers: "Tài khoản",
      forbidden: "Truy cập bị từ chối",
    };
    $("#title").textContent = names[page] || names.dashboard;
    $("#subtitle").textContent = me
      ? `BẾP NHÀ · ${me.fullName || me.username || "NHÂN VIÊN"}`
      : "BẾP NHÀ · QUẢN TRỊ";
    $$("#nav a").forEach((a) => {
      const linkPage = a.hash.slice(1);
      a.hidden = !allowedPages.includes(linkPage);
      a.classList.toggle("active", linkPage === page);
    });
    if (page === "forbidden") {
      app.innerHTML =
        '<div class="panel error"><h2>Truy cập bị từ chối</h2><p>Bạn không có quyền truy cập màn hình này.</p></div>';
      return;
    }
    app.innerHTML = '<div class="empty">Đang tải dữ liệu…</div>';
    try {
      if (page === "dashboard") await dashboard();
      else if (page === "table-map") await tableMap();
      else if (page === "reservations") await reservations();
      else if (page === "orders") await orders();
      else if (page === "kitchen") await kitchen();
      else if (page === "menu") await menu();
      else await customers();
    } catch (e) {
      app.innerHTML = `<div class="panel error">${esc(e.message)}<p>Kiểm tra quyền tài khoản và kết nối API.</p></div>`;
    }
  }
  async function tableMap() {
    const data = await api("/tables/floor-plan");
    const zones = Array.isArray(data) ? data : data.zones || [];
    const tables = zones.flatMap((zone) =>
      (zone.tables || zone.items || []).map((item) => ({
        ...item,
        zoneName: zone.name,
      })),
    );
    const labels = {
      AVAILABLE: "Trống",
      OCCUPIED: "Đang có khách",
      RESERVED: "Đã đặt",
      CLEANING: "Đang dọn dẹp",
    };
    const cards = tables.map((item) => {
      const r = item.upcomingReservation;
      const card = '<article class="card"><strong>' + esc(item.code || item.name || "Bàn") + '</strong><span class="badge">' + esc(labels[item.displayStatus || item.status] || item.displayStatus || item.status || "Chưa rõ") + '</span><small>' + esc(item.zoneName || item.zone?.name || "") + ' · ' + esc(item.capacity || 0) + ' chỗ</small>' +
        (r ? '<div class="reservation-on-table"><b>Khách đã đặt</b><span>' + esc(r.customerName) + '</span><span>' + esc(r.customerPhone) + '</span><span>' + esc(r.partySize) + ' khách · ' + esc(new Date(r.startAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) + '</span><small>Mã ' + esc(r.code) + ' · ' + (r.status === "PENDING" ? "Chờ xác nhận" : "Đã xác nhận") + '</small></div>' : "") + '</article>';
      return card;
    }).join("");
    app.innerHTML = '<div class="account-toolbar"><div><h2>Sơ đồ bàn</h2><p class="muted">Theo dõi tình trạng bàn và thông tin khách đặt.</p></div><button class="quiet" data-reload>Làm mới</button></div><div class="grid">' + (cards || '<div class="panel empty">Chưa có dữ liệu bàn.</div>') + '</div>';
  }

  async function dashboard() {
    const now = new Date(),
      date = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      from = date(now),
      range = query({ from, to: from });
    const [rev, ops] = await Promise.all([
      api("/reports/revenue" + range),
      api("/reports/operations" + range),
    ]);
    const s = rev.summary || {},
      guests = ops.totals?.guests ?? 0,
      sessions = ops.totals?.sessions ?? 0;
    app.innerHTML = `<div class="grid"><div class="card metric"><span>Doanh thu hôm nay</span><strong>${money(s.revenue)}</strong></div><div class="card metric"><span>Hóa đơn đã thanh toán</span><strong>${s.bills || 0}</strong></div><div class="card metric"><span>Khách đã phục vụ</span><strong>${guests}</strong></div><div class="card metric"><span>Lượt mở bàn</span><strong>${sessions}</strong></div></div><div class="panel dashboard-note"><div><h2>Chào ${esc(me?.fullName || "bạn")}</h2><p>${esc(rev.message || "Số liệu hôm nay được đồng bộ từ hệ thống.")}</p></div><div class="quick-links"><a class="primary" href="#reservations">Xem đặt bàn</a><a class="secondary" href="#orders">Theo dõi đơn hàng</a><a class="secondary" href="#kitchen">Mở màn hình bếp</a></div></div><div class="panel"><h2>Doanh thu trong ngày</h2><p class="muted">${esc(from)} · ${rev.growthPercent == null ? "Chưa có dữ liệu so sánh kỳ trước" : `Thay đổi ${rev.growthPercent}% so với kỳ trước`}</p><div class="revenue-strip">${(rev.series || []).map((x) => `<span title="${esc(x.period)}: ${money(x.revenue)}" style="--bar:${Math.max(4, Math.min(100, (Number(x.revenue || 0) / Math.max(1, ...(rev.series || []).map((y) => Number(y.revenue || 0)))) * 100))}%"><i></i><small>${esc(x.period)}</small></span>`).join("") || '<p class="empty">Chưa có dữ liệu doanh thu.</p>'}</div></div>`;
  }
  async function reservations() {
    const data = await api("/reservations" + query({ page: 1, limit: 100 }));
    const list = data.items || data || [];
    const rows = list
      .map(
        (x) =>
          `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.customerName)}<br><small>${esc(x.customerPhone)}</small></td><td>${esc(x.startAt && new Date(x.startAt).toLocaleString("vi-VN"))}<br>${x.partySize || 0} khách · ${esc(x.branch?.name || "")}</td><td><span class="badge status-${esc(String(x.status).toLowerCase())}">${esc(statusName(x.status))}</span></td><td class="user-actions">${x.status === "PENDING" ? act("Xác nhận", `/reservations/${x.id}/confirm`) : ""}${x.status === "CONFIRMED" ? act("Check-in", `/reservations/${x.id}/check-in`) : ""}${["PENDING", "CONFIRMED"].includes(x.status) ? `<button class="action alt" data-reservation-reject="${x.id}">Từ chối</button>` : ""}</td></tr>`,
      )
      .join("");
    app.innerHTML = `<div class="account-toolbar"><div><h2>Quản lý đặt bàn</h2><p class="muted">${data.total ?? list.length} lượt đặt · Lọc và tìm kiếm cục bộ, tải dữ liệu một lần.</p></div><button class="quiet" data-reload>Làm mới</button></div><div class="account-filters"><input id="reservation-search" type="search" placeholder="Tìm mã đặt bàn, tên hoặc số điện thoại"><select id="reservation-status"><option value="">Mọi trạng thái</option>${["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "REJECTED", "NO_SHOW"].map((s) => `<option value="${s}">${statusName(s)}</option>`).join("")}</select><input id="reservation-date" type="date" aria-label="Lọc theo ngày"></div>${table(["Mã đặt", "Khách", "Thời gian", "Trạng thái", "Thao tác"], rows)}`;
    app
      .querySelector("[data-reload]")
      .insertAdjacentHTML(
        "beforebegin",
        '<button class="primary" data-reservation-new>＋ Tạo lịch đặt</button>',
      );
    const apply = () => {
      const q = $("#reservation-search").value.toLocaleLowerCase("vi"),
        st = $("#reservation-status").value,
        dt = $("#reservation-date").value;
      $$("tbody tr", app).forEach((row, i) => {
        const x = list[i],
          matches =
            (!q ||
              [x.code, x.customerName, x.customerPhone].some((v) =>
                String(v || "")
                  .toLocaleLowerCase("vi")
                  .includes(q),
              )) &&
            (!st || x.status === st) &&
            (!dt || String(x.startAt || "").slice(0, 10) === dt);
        row.hidden = !matches;
      });
    };
    $("#reservation-search").oninput = apply;
    $("#reservation-status").onchange = apply;
    $("#reservation-date").onchange = apply;
  }
  async function orders() {
    const data = await api("/orders" + query({ page: 1, limit: 100 }));
    const list = data.items || data || [];
    const rows = list
      .map(
        (x) =>
          `<tr><td><b>${esc(x.code || `#${x.id}`)}</b><br><small>${esc(new Date(x.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }))}</small></td><td>${esc(x.table?.code || x.session?.table?.code || "—")}</td><td>${(x.items || []).map((i) => `${esc(i.quantity)} × ${esc(i.name || i.menuItem?.name || i.combo?.name || "Món")}`).join("<br>") || "—"}</td><td><span class="badge">${esc(statusName(x.status))}</span><br><small>Ưu tiên ${x.priority || 0}</small></td><td class="user-actions">${x.status === "PENDING_CONFIRM" ? act("Gửi bếp", `/orders/${x.id}/send-to-kitchen`) : ""}${x.status === "SENT_TO_KITCHEN" ? `<button class="action alt" data-priority="${x.id}" data-level="${(Number(x.priority || 0) + 1) % 3}">Ưu tiên ${(Number(x.priority || 0) + 1) % 3}</button>` : ""}${(
            x.items || []
          )
            .filter((i) => i.status === "READY")
            .map((i) => act(`Đã giao: ${i.name}`, `/order-items/${i.id}/serve`))
            .join("")}</td></tr>`,
      )
      .join("");
    app.innerHTML = `<div class="account-toolbar"><div><h2>Đơn hàng</h2><p class="muted">${data.total ?? list.length} đơn · Sắp xếp và lọc tại trình duyệt sau một lần tải.</p></div><button class="quiet" data-reload>Làm mới</button></div><div class="account-filters"><input id="order-search" type="search" placeholder="Tìm mã đơn hoặc mã bàn"><select id="order-status"><option value="">Mọi trạng thái</option>${["PENDING_CONFIRM", "SENT_TO_KITCHEN", "PREPARING", "READY", "COMPLETED", "CANCELLED"].map((s) => `<option value="${s}">${statusName(s)}</option>`).join("")}</select></div>${table(["Đơn hàng", "Bàn / giờ", "Món", "Trạng thái", "Thao tác"], rows)}`;
    const apply = () => {
      const q = $("#order-search").value.toLocaleLowerCase("vi"),
        st = $("#order-status").value;
      $$("tbody tr", app).forEach(
        (row, i) =>
          (row.hidden =
            !!(st && list[i].status !== st) ||
            !!(
              q &&
              ![
                list[i].code,
                list[i].table?.code,
                list[i].session?.table?.code,
              ].some((v) =>
                String(v || "")
                  .toLocaleLowerCase("vi")
                  .includes(q),
              )
            )),
      );
    };
    $("#order-search").oninput = apply;
    $("#order-status").onchange = apply;
  }
  async function kitchen() {
    const data = await api("/kitchen/queue"),
      orders = data.orders || [],
      summary = data.summary || {},
      rows = orders
        .flatMap((o) =>
          (o.items || []).map(
            (x) =>
              `<tr><td><b>${esc(o.code || `#${o.id}`)}</b><br><small>${o.waitingMinutes || 0} phút · ${esc(o.createdByWaiter || "")}</small></td><td>${esc(o.table?.code || "—")}<br>${o.guestCount || 0} khách</td><td><b>${esc(x.name || "Món")} × ${esc(x.quantity)}</b>${x.note ? `<br><small>Ghi chú: ${esc(x.note)}</small>` : ""}</td><td><span class="badge">${esc(statusName(x.status))}</span></td><td>${x.status === "PENDING" ? act("Nhận món", `/kitchen/items/${x.id}/status`, "PATCH", { status: "RECEIVED" }) : x.status === "RECEIVED" ? act("Bắt đầu", `/kitchen/items/${x.id}/status`, "PATCH", { status: "PREPARING" }) : x.status === "PREPARING" ? act("Hoàn thành", `/kitchen/items/${x.id}/status`, "PATCH", { status: "READY" }) : x.status === "READY" ? act("Đã giao", `/kitchen/items/${x.id}/status`, "PATCH", { status: "SERVED" }) : ""}</td></tr>`,
          ),
        )
        .join("");
    app.innerHTML = `<div class="account-toolbar"><div><h2>Hàng đợi bếp</h2><p class="muted">Cập nhật món theo thứ tự nhận. Dữ liệu chỉ tải khi mở màn hình hoặc bấm làm mới.</p></div><button class="quiet" data-reload>↻ Làm mới</button></div><div class="grid kitchen-summary">${[
      ["PENDING", "Chờ nhận"],
      ["RECEIVED", "Đã nhận"],
      ["PREPARING", "Đang làm"],
      ["READY", "Sẵn sàng"],
    ]
      .map(
        ([k, label]) =>
          `<div class="card metric"><span>${label}</span><strong>${summary[k] || 0}</strong></div>`,
      )
      .join(
        "",
      )}</div>${table(["Đơn / thời gian chờ", "Bàn", "Món", "Trạng thái", "Cập nhật"], rows)}`;
  }
  async function menu() {
    const [items, cats] = await Promise.all([
      api("/menu/items"),
      api("/menu/categories"),
    ]);
    menuRows = items;
    categoryRows = cats;
    renderMenu();
  }
  function renderMenu() {
    const q = ($("#menu-search")?.value || "").toLocaleLowerCase("vi"),
      cat = Number($("#menu-category")?.value || 0),
      avail = $("#menu-availability")?.value || "";
    const list = menuRows.filter(
      (x) =>
        (!q ||
          [x.name, x.description].some((v) =>
            String(v || "")
              .toLocaleLowerCase("vi")
              .includes(q),
          )) &&
        (!cat || x.categoryId === cat) &&
        (!avail || String(x.isAvailable) === avail),
    );
    const rows = list
      .map(
        (x) =>
          `<tr><td><b>${esc(x.name)}</b><br><small>${esc(x.description || "")}</small></td><td>${esc(x.category?.name || categoryRows.find((c) => c.id === x.categoryId)?.name || "—")}</td><td>${money(x.price)}</td><td><span class="badge">${x.isAvailable ? "Còn món" : "Tạm hết"} · ${x.isVisible ? "Đang hiện" : "Đang ẩn"}</span></td><td class="user-actions"><button class="action alt" data-menu-edit="${x.id}">Sửa</button>${act(x.isAvailable ? "Tạm hết" : "Còn món", `/menu/items/${x.id}/availability`, "PATCH", { isAvailable: !x.isAvailable })}${act(x.isVisible ? "Ẩn món" : "Hiện món", `/menu/items/${x.id}/visibility`, "PATCH", { isVisible: !x.isVisible })}<button class="action alt" data-menu-delete="${x.id}">Xóa</button></td></tr>`,
      )
      .join("");
    app.innerHTML = `<div class="account-toolbar"><div><h2>Thực đơn</h2><p class="muted">${menuRows.length} món · Tìm kiếm và lọc tại chỗ, chỉ gọi API khi cập nhật.</p></div><button class="primary" data-menu-new>＋ Thêm món</button></div><div class="account-filters"><input id="menu-search" type="search" placeholder="Tìm món ăn"><select id="menu-category"><option value="">Tất cả danh mục</option>${categoryRows.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><select id="menu-availability"><option value="">Tất cả tình trạng</option><option value="true">Còn món</option><option value="false">Tạm hết</option></select></div>${table(["Món ăn", "Danh mục", "Giá bán", "Tình trạng", "Thao tác"], rows)}`;
    $("#menu-search").oninput = renderMenu;
    $("#menu-category").onchange = renderMenu;
    $("#menu-availability").onchange = renderMenu;
  }
  async function customers() {
    const data = await api("/admin/users" + query({ page: 1, limit: 200 }));
    userRows = (data.items || data || []).filter(
      (u) => u.role?.code !== "CUSTOMER",
    );
    renderUsers();
  }
  function renderUsers(search = "") {
    const q = search.trim().toLocaleLowerCase("vi");
    const rows = userRows
      .filter(
        (u) =>
          !q ||
          [
            u.fullName,
            u.username,
            u.email,
            u.phone,
            u.role?.name,
            u.branch?.name,
          ].some((v) =>
            String(v || "")
              .toLocaleLowerCase("vi")
              .includes(q),
          ),
      )
      .map(
        (u) =>
          `<tr><td><b>${esc(u.fullName)}</b><br><small>@${esc(u.username || "—")}</small></td><td>${esc(u.email || "—")}<br>${esc(u.phone || "")}</td><td>${esc(u.role?.name || u.role?.code || "—")}</td><td>${esc(u.branch?.name || "Chưa gán")}</td><td><span class="badge ${u.status === "LOCKED" ? "locked" : ""}">${u.status === "LOCKED" ? "Đã khóa" : "Đang hoạt động"}</span></td><td class="user-actions"><button class="action alt" data-user-action="edit" data-id="${u.id}">Sửa</button><button class="action alt" data-user-action="password" data-id="${u.id}">Mật khẩu</button><button class="action ${u.status === "LOCKED" ? "alt" : ""}" data-user-action="${u.status === "LOCKED" ? "unlock" : "lock"}" data-id="${u.id}">${u.status === "LOCKED" ? "Mở khóa" : "Khóa"}</button></td></tr>`,
      )
      .join("");
    app.innerHTML = `<div class="account-toolbar"><div><h2>Tài khoản nhân viên</h2><p class="muted">${userRows.length} tài khoản · Tìm kiếm ngay trên danh sách, không gọi API thêm.</p></div><button class="primary" data-user-action="create">＋ Tạo tài khoản</button></div><div class="account-filters"><input id="user-search" type="search" placeholder="Tìm tên, username, email, số điện thoại…" aria-label="Tìm tài khoản"><select id="role-filter"><option value="">Tất cả vai trò</option>${Object.entries(
      roleNames,
    )
      .map(([code, name]) => `<option value="${code}">${name}</option>`)
      .join(
        "",
      )}</select><select id="status-filter"><option value="">Mọi trạng thái</option><option value="ACTIVE">Đang hoạt động</option><option value="LOCKED">Đã khóa</option></select></div>${table(["Nhân viên", "Liên hệ", "Vai trò", "Chi nhánh", "Trạng thái", "Thao tác"], rows)}`;
    $("#user-search").value = search;
    $("#user-search").oninput = filterUsers;
    $("#role-filter").onchange = filterUsers;
    $("#status-filter").onchange = filterUsers;
  }
  function filterUsers() {
    const role = $("#role-filter").value,
      status = $("#status-filter").value,
      q = $("#user-search").value.trim().toLocaleLowerCase("vi");
    const filtered = userRows.filter(
      (u) =>
        (!role || u.role?.code === role) &&
        (!status || u.status === status) &&
        (!q ||
          [
            u.fullName,
            u.username,
            u.email,
            u.phone,
            u.role?.name,
            u.branch?.name,
          ].some((v) =>
            String(v || "")
              .toLocaleLowerCase("vi")
              .includes(q),
          )),
    );
    const rows = filtered
      .map(
        (u) =>
          `<tr><td><b>${esc(u.fullName)}</b><br><small>@${esc(u.username || "—")}</small></td><td>${esc(u.email || "—")}<br>${esc(u.phone || "")}</td><td>${esc(u.role?.name || u.role?.code || "—")}</td><td>${esc(u.branch?.name || "Chưa gán")}</td><td><span class="badge">${u.status === "LOCKED" ? "Đã khóa" : "Đang hoạt động"}</span></td><td class="user-actions"><button class="action alt" data-user-action="edit" data-id="${u.id}">Sửa</button><button class="action alt" data-user-action="password" data-id="${u.id}">Mật khẩu</button><button class="action ${u.status === "LOCKED" ? "alt" : ""}" data-user-action="${u.status === "LOCKED" ? "unlock" : "lock"}" data-id="${u.id}">${u.status === "LOCKED" ? "Mở khóa" : "Khóa"}</button></td></tr>`,
      )
      .join("");
    const body = $("tbody", app);
    body.innerHTML =
      rows ||
      '<tr><td colspan="6" class="empty">Không tìm thấy tài khoản phù hợp.</td></tr>';
  }
  async function branches() {
    if (!branchRows) branchRows = await api("/public/branches");
    return branchRows;
  }
  function openMenuForm(item = {}) {
    const f = $("#account-form");
    f.dataset.mode = item.id ? "menu-edit" : "menu-create";
    f.dataset.id = item.id || "";
    f.innerHTML = `<h2>${item.id ? "Sửa món" : "Thêm món"}</h2><div class="dialog-grid"><label class="span-2">Tên món<input name="name" required maxlength="120" value="${esc(item.name || "")}"></label><label>Danh mục<select name="categoryId" required>${categoryRows.map((c) => `<option value="${c.id}" ${item.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><label>Giá (₫)<input name="price" type="number" min="1" step="1000" required value="${esc(item.price || "")}"></label><label>Thời gian chế biến (phút)<input name="prepTimeMinutes" type="number" min="1" value="${esc(item.prepTimeMinutes || "")}"></label><label>Ảnh (đường dẫn)<input name="imageUrl" value="${esc(item.imageUrl || "")}"></label><label class="span-2">Mô tả<textarea name="description" rows="3">${esc(item.description || "")}</textarea></label>${item.id ? `<label><input name="isAvailable" type="checkbox" ${item.isAvailable ? "checked" : ""}> Đang có món</label><label><input name="isVisible" type="checkbox" ${item.isVisible ? "checked" : ""}> Hiện trên thực đơn</label>` : ""}</div><div class="dialog-actions"><button type="button" class="secondary" data-close-account>Hủy</button><button class="primary">${item.id ? "Lưu món" : "Tạo món"}</button></div><p class="error" id="account-error"></p>`;
    $("#account-dialog").showModal();
  }
  async function submitMenuForm(e) {
    e.preventDefault();
    const f = e.currentTarget,
      fd = new FormData(f),
      edit = f.dataset.mode === "menu-edit",
      body = {
        name: String(fd.get("name")).trim(),
        categoryId: Number(fd.get("categoryId")),
        price: Number(fd.get("price")),
        description: String(fd.get("description") || "").trim(),
      };
    if (fd.get("prepTimeMinutes"))
      body.prepTimeMinutes = Number(fd.get("prepTimeMinutes"));
    if (fd.get("imageUrl")) body.imageUrl = String(fd.get("imageUrl")).trim();
    if (edit) {
      body.isAvailable = f.elements.isAvailable.checked;
      body.isVisible = f.elements.isVisible.checked;
    }
    try {
      await api(edit ? `/menu/items/${f.dataset.id}` : "/menu/items", {
        method: edit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      $("#account-dialog").close();
      toast(edit ? "Đã lưu món" : "Đã thêm món");
      await load();
    } catch (err) {
      $("#account-error").textContent = err.message;
    }
  }
  async function openReservationForm() {
    const bs = await branches(),
      f = $("#account-form");
    f.dataset.mode = "reservation-create";
    f.innerHTML = `<h2>Tạo lịch đặt bàn</h2><p class="hint">Nhập thông tin khách. Hệ thống sẽ kiểm tra quy tắc đặt bàn khi lưu.</p><div class="dialog-grid"><label class="span-2">Khách hàng<input name="customerName" required maxlength="100"></label><label>Số điện thoại<input name="customerPhone" required placeholder="090…"></label><label>Email<input name="customerEmail" type="email"></label><label>Chi nhánh<select name="branchId" required>${bs.map((b) => `<option value="${b.id}" ${Number(me?.branchId) === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label><label>Số khách<input name="partySize" type="number" min="1" max="12" value="2" required></label><label class="span-2">Thời gian đến<input name="startAt" type="datetime-local" required></label><label class="span-2">Ghi chú<textarea name="note" rows="2" maxlength="500"></textarea></label></div><div class="dialog-actions"><button type="button" class="secondary" data-close-account>Hủy</button><button class="primary">Tạo lịch đặt</button></div><p class="error" id="account-error"></p>`;
    $("#account-dialog").showModal();
  }
  async function submitReservationForm(e) {
    e.preventDefault();
    const f = e.currentTarget,
      fd = new FormData(f),
      body = {
        branchId: Number(fd.get("branchId")),
        startAt: new Date(fd.get("startAt")).toISOString(),
        partySize: Number(fd.get("partySize")),
        customerName: String(fd.get("customerName")).trim(),
        customerPhone: String(fd.get("customerPhone")).trim(),
      };
    if (fd.get("customerEmail")) body.customerEmail = fd.get("customerEmail");
    if (fd.get("note")) body.note = fd.get("note");
    try {
      await api("/reservations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      $("#account-dialog").close();
      toast("Đã tạo lịch đặt");
      await load();
    } catch (err) {
      $("#account-error").textContent = err.message;
    }
  }
  async function openUserForm(mode, user = {}) {
    const d = $("#account-dialog"),
      f = $("#account-form");
    f.dataset.mode = mode;
    f.dataset.id = user.id || "";
    f.innerHTML = `<h2>${mode === "create" ? "Tạo tài khoản nhân viên" : "Cập nhật tài khoản"}</h2><p class="hint">Tài khoản dùng username và mật khẩu để đăng nhập. Mật khẩu tối thiểu 8 ký tự.</p><div class="dialog-grid"><label class="span-2">Họ tên<input name="fullName" maxlength="100" required value="${esc(user.fullName || "")}"></label><label>Tên đăng nhập<input name="username" minlength="3" maxlength="30" pattern="[a-zA-Z0-9._]+" required value="${esc(user.username || "")}"></label><label>Vai trò<select name="roleCode" required>${Object.entries(
      roleNames,
    )
      .map(
        ([code, name]) =>
          `<option value="${code}" ${user.role?.code === code ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Email (không bắt buộc)<input name="email" type="email" value="${esc(user.email || "")}"></label><label>Số điện thoại<input name="phone" type="tel" value="${esc(user.phone || "")}"></label><label class="span-2">Chi nhánh<select name="branchId"><option value="">Không gán chi nhánh</option></select></label>${mode === "create" ? '<label class="span-2">Mật khẩu ban đầu<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>' : ""}</div><div class="dialog-actions"><button type="button" class="secondary" data-close-account>Hủy</button><button class="primary">${mode === "create" ? "Tạo tài khoản" : "Lưu thay đổi"}</button></div><p class="error" id="account-error"></p>`;
    try {
      const bs = await branches();
      const select = f.elements.branchId;
      select.innerHTML =
        '<option value="">Không gán chi nhánh</option>' +
        bs
          .map(
            (b) =>
              `<option value="${b.id}" ${Number(user.branchId ?? user.branch?.id) === b.id ? "selected" : ""}>${esc(b.name)}</option>`,
          )
          .join("");
    } catch (e) {
      $("#account-error").textContent =
        `Không tải được danh sách chi nhánh: ${e.message}`;
    }
    d.showModal();
  }
  async function submitUserForm(e) {
    e.preventDefault();
    const f = e.currentTarget,
      mode = f.dataset.mode,
      fd = new FormData(f),
      id = f.dataset.id;
    const body = {
      fullName: String(fd.get("fullName")).trim(),
      username: String(fd.get("username")).trim().toLowerCase(),
      roleCode: fd.get("roleCode"),
      branchId: fd.get("branchId") ? Number(fd.get("branchId")) : null,
    };
    if (fd.get("email")) body.email = String(fd.get("email")).trim();
    if (fd.get("phone")) body.phone = String(fd.get("phone")).trim();
    if (mode === "create") body.password = fd.get("password");
    const err = $("#account-error");
    try {
      await api(mode === "create" ? "/admin/users" : `/admin/users/${id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        body: JSON.stringify(body),
      });
      $("#account-dialog").close();
      toast(mode === "create" ? "Đã tạo tài khoản" : "Đã cập nhật tài khoản");
      await load();
    } catch (e) {
      err.textContent = e.message;
    }
  }
  async function resetUserPassword(user) {
    const d = $("#account-dialog"),
      f = $("#account-form");
    f.dataset.mode = "reset";
    f.dataset.id = user.id;
    f.innerHTML = `<h2>Đặt lại mật khẩu</h2><p>Đổi mật khẩu cho <b>${esc(user.fullName)}</b> (@${esc(user.username)}). Các phiên đăng nhập hiện tại sẽ bị thu hồi.</p><label>Mật khẩu mới <span class="hint">Để trống để hệ thống tự tạo mật khẩu tạm</span><input name="newPassword" type="password" minlength="8" autocomplete="new-password"></label><div class="dialog-actions"><button type="button" class="secondary" data-close-account>Hủy</button><button class="primary">Đặt lại mật khẩu</button></div><p class="error" id="account-error"></p>`;
    d.showModal();
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-reload]")) {
      responseCache.clear();
      return load();
    }
    if (e.target.closest("[data-close-account]"))
      return $("#account-dialog").close();
    const ub = e.target.closest("[data-user-action]");
    if (ub) {
      const action = ub.dataset.userAction,
        user = userRows.find((x) => String(x.id) === ub.dataset.id);
      if (action === "create")
        return openUserForm("create", { branchId: me?.branchId });
      if (action === "edit") return openUserForm("edit", user);
      if (action === "password") return resetUserPassword(user);
      if (action === "lock" || action === "unlock") {
        if (action === "lock" && !confirm(`Khóa tài khoản ${user.fullName}?`))
          return;
        try {
          await api(`/admin/users/${user.id}/${action}`, {
            method: "POST",
            body: action === "lock" ? JSON.stringify({}) : undefined,
          });
          toast(
            action === "lock" ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản",
          );
          await load();
        } catch (err) {
          toast(err.message);
        }
      }
      return;
    }
    if (e.target.closest("[data-copy-password]")) {
      const value = e.target.closest("[data-copy-password]").dataset
        .copyPassword;
      await navigator.clipboard.writeText(value);
      toast("Đã sao chép mật khẩu");
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    try {
      await api(b.dataset.act, {
        method: b.dataset.method,
        body: b.dataset.method === "GET" ? undefined : b.dataset.body,
      });
      toast("Đã cập nhật");
      await load();
    } catch (err) {
      toast(err.message);
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(
      "[data-menu-new],[data-menu-edit],[data-menu-delete],[data-reservation-new],[data-reservation-reject],[data-priority]",
    );
    if (!b) return;
    try {
      if (b.hasAttribute("data-menu-new")) openMenuForm();
      else if (b.hasAttribute("data-menu-edit"))
        openMenuForm(menuRows.find((x) => String(x.id) === b.dataset.menuEdit));
      else if (b.hasAttribute("data-menu-delete")) {
        if (!confirm("Xóa món này khỏi thực đơn khách hàng?")) return;
        await api(`/menu/items/${b.dataset.menuDelete}`, { method: "DELETE" });
        toast("Đã xóa món khỏi thực đơn");
        await load();
      }
      else if (b.hasAttribute("data-reservation-new"))
        await openReservationForm();
      else if (b.hasAttribute("data-reservation-reject")) {
        const reason = prompt("Lý do từ chối lịch đặt bàn?");
        if (reason === null || !reason.trim()) return;
        await api(`/reservations/${b.dataset.reservationReject}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        toast("Đã từ chối lịch đặt");
        await load();
      } else if (b.hasAttribute("data-priority")) {
        await api(`/orders/${b.dataset.priority}/priority`, {
          method: "PATCH",
          body: JSON.stringify({ priority: Number(b.dataset.level) }),
        });
        toast("Đã cập nhật mức ưu tiên");
        await load();
      }
    } catch (err) {
      toast(err.message);
    }
  });
  $("#account-form").addEventListener("submit", async (e) => {
    const mode = e.currentTarget.dataset.mode;
    if (mode === "reset") {
      e.preventDefault();
      const f = e.currentTarget,
        id = f.dataset.id,
        pw = new FormData(f).get("newPassword") || "";
      try {
        const result = await api(`/admin/users/${id}/reset-password`, {
          method: "POST",
          body: JSON.stringify(pw ? { newPassword: pw } : {}),
        });
        const generated = pw || result.temporaryPassword;
        f.innerHTML = `<h2>Mật khẩu đã được đổi</h2><p>Gửi mật khẩu này cho nhân viên qua kênh riêng.</p><div class="copy-box" id="new-password">${esc(generated)}</div><div class="dialog-actions"><button type="button" class="secondary" data-copy-password="${esc(generated)}">Sao chép</button><button type="button" class="primary" data-close-account>Đóng</button></div>`;
        await load();
      } catch (err) {
        $("#account-error").textContent = err.message;
      }
    } else if (mode === "menu-create" || mode === "menu-edit")
      submitMenuForm(e);
    else if (mode === "reservation-create") submitReservationForm(e);
    else submitUserForm(e);
  });
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: f.get("identifier"),
          password: f.get("password"),
        }),
      });
      token = data.accessToken;
      localStorage.setItem("bn_access", token);
      me = data.user || null;
      connectRealtime();
      dlg.close();
      location.hash = roleHome[me?.role?.code || me?.roleCode] || "dashboard";
      await load();
    } catch (err) {
      $("#login-error").textContent = err.message;
    }
  });
  $("#logout").onclick = async () => {
    try {
      if (token) await api("/auth/logout", { method: "POST" });
    } catch {
      // Xóa phiên cục bộ ngay cả khi máy chủ tạm thời không phản hồi.
    }
    token = null;
    me = null;
    realtimeSocket?.disconnect();
    realtimeSocket = null;
    responseCache.clear();
    localStorage.removeItem("bn_access");
    dlg.showModal();
  };
  $("#reload").onclick = () => {
    responseCache.clear();
    load();
  };
  addEventListener("hashchange", load);
  if (token)
    api("/auth/me")
      .then((x) => {
        me = x;
        connectRealtime();
        load();
      })
      .catch(() => {
        token = null;
        localStorage.removeItem("bn_access");
        dlg.showModal();
      });
  else dlg.showModal();
})();
