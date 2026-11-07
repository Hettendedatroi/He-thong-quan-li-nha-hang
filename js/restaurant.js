(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const api = ["localhost:5173", "127.0.0.1:5173"].includes(location.host)
    ? "http://127.0.0.1:3000/api"
    : "/api";
  const toast = (message) => {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    window.setTimeout(() => node.classList.remove("show"), 2800);
  };
  const bookingResult = $("#booking-result");
  const showBookingConfirmation = (result, guest) => {
    const time = result.startAt
      ? new Date(result.startAt).toLocaleString("vi-VN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
    $("#booking-result-code").textContent = result.code || "—";
    $("#booking-result-guest").textContent = `${guest.name} · ${guest.phone}`;
    $("#booking-result-time").textContent = time;
    $("#booking-result-count").textContent = `${result.partySize || guest.partySize} người`;
    $("#booking-result-status").textContent =
      result.status === "PENDING" ? "Chờ nhà hàng xác nhận" : "Đã xác nhận";
    $("#booking-result-table").textContent = result.table?.code
      ? `Bàn ${result.table.code}`
      : "Nhà hàng sẽ sắp xếp bàn";
    $("#booking-result-zone").textContent = result.table?.zone?.name || "";
    $("#booking-result-intro").textContent = result.areaAdjusted
      ? "Khu vực bạn chọn đã hết bàn; nhà hàng đã tự chọn bàn trống gần nhất phù hợp với số khách."
      : "Nhà hàng đã tự động chọn bàn còn trống phù hợp với số khách.";
    const qr = $("#booking-result-qr");
    qr.hidden = !result.qrCode;
    if (result.qrCode) qr.src = result.qrCode;
    if (bookingResult?.showModal) bookingResult.showModal();
    else toast(`Đặt bàn ${result.code} thành công · Bàn ${result.table?.code || "sẽ được sắp xếp"}`);
  };
  $$('[data-close-booking]').forEach((button) =>
    button.addEventListener("click", () => bookingResult?.close()),
  );
  const today = new Date();
  const dateField = $('input[type="date"]');
  const localDate = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  };
  if (dateField) dateField.value = localDate(today);
  let occupancyRequest = 0;
  const refreshOccupancy = async () => {
    const date = dateField?.value;
    const time = $('[name="time"]')?.value;
    if (!date || !time) return;
    const requestId = ++occupancyRequest;
    const startAt = new Date(`${date}T${time}:00+07:00`).toISOString();
    const params = new URLSearchParams({ branchId: "1", startAt, partySize: "1" });
    try {
      const response = await fetch(`${api}/public/reservations/occupancy?${params}`);
      if (!response.ok) throw Error("Không tải được tình trạng bàn");
      const data = await response.json();
      if (requestId !== occupancyRequest) return;
      $("#booking-occupancy-percent").textContent = `${data.percentBooked}%`;
      $("#booking-occupancy-bar").style.width = `${data.percentBooked}%`;
      $("#booking-occupancy-caption").textContent = data.totalTables
        ? `Đã đặt ${data.bookedTables}/${data.totalTables} bàn · Còn ${data.availableTables} bàn vào ${time}`
        : "Chi nhánh chưa có bàn hoạt động.";
    } catch {
      if (requestId !== occupancyRequest) return;
      $("#booking-occupancy-percent").textContent = "—%";
      $("#booking-occupancy-bar").style.width = "0%";
      $("#booking-occupancy-caption").textContent = "Chưa tải được số liệu bàn.";
    }
  };
  dateField?.addEventListener("change", refreshOccupancy);
  $('[name="time"]')?.addEventListener("change", refreshOccupancy);
  refreshOccupancy();
  let guests = 2;
  $$("[data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      guests = Math.max(1, Math.min(12, guests + Number(button.dataset.step)));
      const count = $("#guest-count");
      if (count) count.textContent = `${guests} người`;
    }),
  );
  $$(".table-option").forEach((option) =>
    option.addEventListener("click", () => {
      $$(".table-option").forEach((item) => item.classList.remove("selected"));
      option.classList.add("selected");
      option.querySelector("input").checked = true;
    }),
  );
  const bookingForm = $("#booking-form");
  if (bookingForm)
    bookingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(bookingForm);
      const locationType = {
        "Trong nhà": "INDOOR",
        "Sân vườn": "OUTDOOR",
        "Phòng riêng": "VIP",
      }[data.get("area")];
      let response;
      try {
        response = await fetch(`${api}/public/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: 1,
            startAt: new Date(
              `${data.get("date")}T${data.get("time")}:00+07:00`,
            ).toISOString(),
            partySize: guests,
            locationType,
            customerName: String(data.get("name") || "").trim(),
            customerPhone: String(data.get("phone") || "").trim(),
            note: String(data.get("note") || "").trim() || undefined,
          }),
        });
      } catch {
        toast("Không kết nối được máy chủ. Vui lòng thử lại.");
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = Array.isArray(result.message)
          ? result.message.join("; ")
          : typeof result.message === "string"
            ? result.message
            : response.status >= 502
              ? "Máy chủ đang khởi động hoặc tạm thời quá tải. Vui lòng thử lại sau ít giây."
              : `Không thể đặt bàn (mã lỗi ${response.status})`;
        toast(message);
        return;
      }
      showBookingConfirmation(result, {
        name: String(data.get("name") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        partySize: guests,
      });
      bookingForm.reset();
      if (dateField) dateField.value = localDate(new Date());
      guests = 2;
      const count = $("#guest-count");
      if (count) count.textContent = "2 người";
    });
  const modal = $("#booking-modal");
  $$("[data-open-modal]").forEach((button) =>
    button.addEventListener("click", () => modal?.classList.add("open")),
  );
  $$("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", () => modal?.classList.remove("open")),
  );
  const quickBooking = $("#quick-booking");
  if (quickBooking)
    quickBooking.addEventListener("submit", (event) => {
      event.preventDefault();
      modal.classList.remove("open");
      toast("Đặt bàn mới đã được thêm vào lịch hôm nay.");
    });
  $$(".table").forEach((table) =>
    table.addEventListener("click", () => {
      const labels = {
        available: "đang trống",
        occupied: "đang có khách",
        reserved: "đã được đặt",
      };
      const state = [...table.classList].find((item) => labels[item]);
      const help = $("#table-help");
      if (help)
        help.textContent = `Bàn ${table.dataset.table} ${labels[state]}. Bấm lại để cập nhật`;
    }),
  );
  $("[data-theme-toggle]")?.addEventListener("click", () =>
    document.body.classList.toggle("soft-contrast"),
  );
})();
