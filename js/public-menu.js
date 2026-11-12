(() => {
  const root = document.querySelector('#public-menu');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price = n => `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
  const api = ['localhost:5173','127.0.0.1:5173'].includes(location.host) ? 'http://127.0.0.1:3000/api' : '/api';
  const qr = new URLSearchParams(location.search).get('table');
  const sessionKey = qr ? `restaurant_table_session_${qr}` : '';
  let sessionToken = sessionKey ? sessionStorage.getItem(sessionKey) : '';
  let tableInfo = null;
  let menuData = null;
  let cart = { items: [], total: 0 };

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Lỗi ${response.status}`);
    return data;
  }

  async function initTable() {
    if (!qr) return;
    try {
      if (!sessionToken) {
        const session = await request(`/public/tables/${encodeURIComponent(qr)}/session`, { method: 'POST', body: '{}' });
        sessionToken = session.sessionToken;
        sessionStorage.setItem(sessionKey, sessionToken);
        tableInfo = session.table;
      } else {
        const session = await request(`/public/sessions/${encodeURIComponent(sessionToken)}`);
        tableInfo = { code: session.table?.code, zone: session.table?.zone?.name };
      }
      cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart`);
    } catch (error) {
      sessionToken = '';
      sessionStorage.removeItem(sessionKey);
      showNotice(`Không mở được phiên bàn: ${error.message}. Hãy quét lại QR trên bàn.`);
    }
  }

  async function load() {
    root.innerHTML = '<p>Đang tải thực đơn…</p>';
    try {
      await initTable();
      menuData = await request('/public/menu?lang=vi');
      render();
      renderCartButton();
    } catch (error) {
      root.innerHTML = `<p class="error">${esc(error.message)}. Hãy thử tải lại sau.</p>`;
    }
  }

  function render() {
    const selected = document.querySelector('#public-category')?.value || '';
    const cats = (menuData.categories || []).filter(c => !selected || String(c.id) === selected);
    root.innerHTML = `<div class="menu-context">${qr && sessionToken ? `<span class="table-badge">Đang gọi tại <b>${esc(tableInfo?.code || 'bàn')}</b>${tableInfo?.zone ? ` · ${esc(tableInfo.zone)}` : ''}</span>` : '<span class="table-hint">Muốn gọi món tại bàn? Hãy quét mã QR trên bàn trước khi chọn món.</span>'}</div><h1>${esc(menuData.restaurant?.name || 'Thực đơn Bếp Nhà')}</h1><p>${esc(menuData.restaurant?.description || menuData.restaurant?.branchName || '')}</p><label class="public-filter">Lọc danh mục <select id="public-category"><option value="">Tất cả danh mục</option>${(menuData.categories || []).map(c => `<option value="${c.id}" ${String(c.id) === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>${cats.map(c => `<section class="category"><h2>${esc(c.name)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ''}<div class="dish-list">${(c.items || []).map(i => `<article class="dish ${i.inStock ? 'dish-clickable' : 'dish-disabled'}" ${i.inStock ? `data-item="${i.id}"` : ''}>${i.imageUrl ? `<img loading="lazy" src="${esc(i.imageUrl)}" alt="${esc(i.name)}">` : ''}<h3>${esc(i.name)}</h3><p>${esc(i.description || '')}</p><span class="price">${price(i.promoPrice ?? i.price)}</span> · <span class="${i.inStock ? '' : 'unavailable'}">${i.inStock ? 'Còn món' : 'Tạm hết'}</span>${i.inStock ? '<button class="dish-add" type="button">Chọn món ＋</button>' : ''}</article>`).join('')}</div></section>`).join('') || '<p>Hiện chưa có món ăn trong danh mục này.</p>'}`;
    document.querySelector('#public-category').onchange = render;
    root.querySelectorAll('[data-item]').forEach(card => card.addEventListener('click', () => openItem(Number(card.dataset.item))));
  }

  function renderCartButton() {
    document.querySelector('#cart-fab')?.remove();
    if (!sessionToken) return;
    const count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const button = document.createElement('button');
    button.id = 'cart-fab'; button.className = 'cart-fab'; button.type = 'button';
    button.innerHTML = `<span aria-hidden="true">🛒</span><span>Giỏ hàng</span><b>${count}</b>`;
    button.addEventListener('click', openCart);
    document.body.appendChild(button);
  }

  function showNotice(message) {
    document.querySelector('#menu-notice')?.remove();
    const notice = document.createElement('div'); notice.id = 'menu-notice'; notice.className = 'menu-notice';
    notice.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="Đóng">×</button>`;
    notice.querySelector('button').onclick = () => notice.remove(); document.body.appendChild(notice);
  }

  function openDialog(title, body, actions) {
    document.querySelector('#menu-dialog')?.remove();
    const dialog = document.createElement('dialog'); dialog.id = 'menu-dialog'; dialog.className = 'menu-dialog';
    dialog.innerHTML = `<form method="dialog" class="dialog-card"><button class="dialog-close" aria-label="Đóng">×</button><h2>${esc(title)}</h2><div class="dialog-body">${body}</div><div class="dialog-actions">${actions}</div></form>`;
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.appendChild(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove()); return dialog;
  }

  function openItem(id) {
    if (!sessionToken) { showNotice('Hãy quét QR trên bàn để hệ thống xác định đúng bàn trước khi gọi món.'); return; }
    const item = (menuData.categories || []).flatMap(c => c.items || []).find(i => Number(i.id) === id);
    if (!item || !item.inStock) return;
    const dialog = openDialog(item.name, `<p>${esc(item.description || 'Món ăn tươi ngon từ Bếp Nhà.')}</p><p class="dialog-price">${price(item.promoPrice ?? item.price)}</p><label>Số lượng<input name="quantity" type="number" min="1" max="20" value="1" required></label><label>Ghi chú cho bếp<textarea name="note" maxlength="100" placeholder="Ví dụ: ít cay, không hành"></textarea></label>`, '<button class="button light" value="cancel">Đóng</button><button class="button primary" type="button" data-add>Thêm vào giỏ</button>');
    dialog.querySelector('[data-add]').onclick = async () => {
      const quantity = Number(dialog.querySelector('[name=quantity]').value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) { showNotice('Số lượng mỗi món từ 1 đến 20.'); return; }
      try {
        cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart/items`, { method: 'POST', body: JSON.stringify({ menuItemId: id, quantity, note: dialog.querySelector('[name=note]').value.trim() || undefined }) });
        dialog.close(); renderCartButton(); showNotice(`${item.name} đã được thêm vào giỏ.`);
      } catch (error) { showNotice(error.message); }
    };
  }

  async function refreshCart() { cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart`); renderCartButton(); }

  async function openCart() {
    try { await refreshCart(); } catch (error) { showNotice(error.message); return; }
    const lines = cart.items.map(i => `<div class="cart-line"><div><b>${esc(i.name)}</b><small>${price(i.unitPrice)} / món</small><label>Ghi chú<input data-note="${i.id}" maxlength="100" value="${esc(i.note || '')}" placeholder="Ghi chú"></label></div><div class="cart-quantity"><button type="button" data-qty="${i.id}" data-delta="-1" aria-label="Giảm">−</button><b>${i.quantity}</b><button type="button" data-qty="${i.id}" data-delta="1" aria-label="Tăng">+</button><button type="button" class="cart-remove" data-remove="${i.id}">Xóa</button></div></div>`).join('');
    const dialog = openDialog(`Giỏ hàng · Bàn ${tableInfo?.code || ''}`, `<div class="cart-lines">${lines || '<p>Giỏ hàng đang trống.</p>'}</div><div class="cart-total"><span>Tạm tính</span><b>${price(cart.total)}</b></div><p class="cart-footnote">Đơn sẽ được chuyển đến bếp sau khi bạn xác nhận.</p>`, `<button class="button light" value="cancel">Tiếp tục chọn</button>${lines ? '<button class="button primary" type="button" data-submit>Gửi đơn xuống bếp</button>' : ''}`);
    dialog.querySelectorAll('[data-qty]').forEach(button => button.onclick = async () => {
      const item = cart.items.find(i => i.id === Number(button.dataset.qty)); const quantity = item.quantity + Number(button.dataset.delta);
      try { if (quantity < 1) cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart/items/${item.id}`, { method: 'DELETE' }); else cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }); dialog.close(); openCart(); } catch (error) { showNotice(error.message); }
    });
    dialog.querySelectorAll('[data-remove]').forEach(button => button.onclick = async () => {
      try { cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart/items/${button.dataset.remove}`, { method: 'DELETE' }); dialog.close(); openCart(); } catch (error) { showNotice(error.message); }
    });
    dialog.querySelectorAll('[data-note]').forEach(input => input.addEventListener('change', async () => {
      try { cart = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/cart/items/${input.dataset.note}`, { method: 'PATCH', body: JSON.stringify({ note: input.value.trim() }) }); }
      catch (error) { showNotice(error.message); }
    }));
    dialog.querySelector('[data-submit]')?.addEventListener('click', async () => {
      const submit = dialog.querySelector('[data-submit]'); submit.disabled = true; submit.textContent = 'Đang gửi…';
      try {
        const order = await request(`/public/sessions/${encodeURIComponent(sessionToken)}/orders`, { method: 'POST', body: '{}' });
        cart = { items: [], total: 0 }; dialog.close(); renderCartButton();
        openDialog('Đã gửi đơn', `<p>Đơn <b>${esc(order.code || '')}</b> của bàn <b>${esc(tableInfo?.code || '')}</b> đã được gửi.</p><p>${order.status === 'PENDING_CONFIRM' ? 'Đơn đang chờ nhân viên xác nhận trước khi bếp nhận.' : 'Bếp đã nhận đơn và sẽ bắt đầu chế biến.'}</p>`, '<button class="button primary" value="ok">Đóng</button>');
      } catch (error) { submit.disabled = false; submit.textContent = 'Gửi đơn xuống bếp'; showNotice(error.message); }
    });
  }

  load();
  const socketScript = document.createElement('script');
  socketScript.src = `${api.replace(/\/api$/, '')}/socket.io/socket.io.js`;
  socketScript.onload = () => {
    if (!window.io) return;
    const socket = window.io(api.replace(/\/api$/, ''), sessionToken ? { auth: { sessionToken } } : {});
    socket.on('menu.updated', load); socket.on('menu.item-updated', load);
    socket.on('cart.updated', updated => { cart = updated; renderCartButton(); });
    socket.on('session.moved', moved => { tableInfo.code = moved.tableCode; render(); renderCartButton(); });
  };
  document.head.appendChild(socketScript);
})();
