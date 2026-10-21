(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const toast = (message) => {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    window.setTimeout(() => node.classList.remove("show"), 2800);
  };
  const today = new Date();
  const dateField = $('input[type="date"]');
  if (dateField) dateField.value = today.toISOString().slice(0, 10);
  let guests = 2;
  $$("[data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      guests = Math.max(1, Math.min(20, guests + Number(button.dataset.step)));
      const count = $("#guest-count");
      if (count) count.textContent = `${guests} nguoi`;
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
    bookingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(bookingForm);
      localStorage.setItem(
        "restaurantBooking",
        JSON.stringify({
          name: data.get("name"),
          date: data.get("date"),
          time: data.get("time"),
          guests,
          area: data.get("area"),
        }),
      );
      toast("Da nhan yeu cau dat ban. Hen gap ban tai Bep Nha!");
      bookingForm.reset();
      if (dateField) dateField.value = today.toISOString().slice(0, 10);
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
      toast("Dat ban moi da duoc them vao lich hom nay.");
    });
  $$(".table").forEach((table) =>
    table.addEventListener("click", () => {
      const labels = {
        available: "dang trong",
        occupied: "dang co khach",
        reserved: "da duoc dat",
      };
      const state = [...table.classList].find((item) => labels[item]);
      const help = $("#table-help");
      if (help)
        help.textContent = `Ban ${table.dataset.table} ${labels[state]}. Bam lai de cap nhat`;
    }),
  );
  $("[data-theme-toggle]")?.addEventListener("click", () =>
    document.body.classList.toggle("soft-contrast"),
  );
})();
