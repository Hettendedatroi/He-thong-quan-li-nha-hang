(() => {
  const root = document.querySelector('#public-menu');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price = n => `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
  const api = ['localhost:5173','127.0.0.1:5173'].includes(location.host) ? 'http://127.0.0.1:3000/api' : '/api';
  let categories = [];
  async function load() {
    root.innerHTML = '<p>Đang tải thực đơn…</p>';
    try {
      const res = await fetch(`${api}/public/menu?lang=vi`);
      if (!res.ok) throw Error(`Không tải được thực đơn (${res.status})`);
      const data = await res.json();
      categories = data.categories || [];
      render(data);
    } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}. Hãy thử tải lại sau.</p>`; }
  }
  function render(data) {
    const selected = document.querySelector('#public-category')?.value || '';
    const cats = categories.filter(c => !selected || String(c.id) === selected);
    root.innerHTML = `<h1>${esc(data.restaurant?.name || 'Thực đơn Bếp Nhà')}</h1><p>${esc(data.restaurant?.description || data.restaurant?.branchName || '')}</p><label class="public-filter">Lọc danh mục <select id="public-category"><option value="">Tất cả danh mục</option>${categories.map(c => `<option value="${c.id}" ${String(c.id) === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>${cats.map(c => `<section class="category"><h2>${esc(c.name)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ''}<div class="dish-list">${(c.items || []).map(i => `<article class="dish">${i.imageUrl ? `<img loading="lazy" src="${esc(i.imageUrl)}" alt="${esc(i.name)}">` : ''}<h3>${esc(i.name)}</h3><p>${esc(i.description || '')}</p><span class="price">${price(i.promoPrice ?? i.price)}</span> · <span class="${i.inStock ? '' : 'unavailable'}">${i.inStock ? 'Còn món' : 'Tạm hết'}</span></article>`).join('')}</div></section>`).join('') || '<p>Hiện chưa có món ăn trong danh mục này.</p>'}`;
    document.querySelector('#public-category').onchange = () => render(data);
  }
  load();
  // Menu changes are broadcast by the API after edits, deletes, visibility and stock updates.
  const socketScript = document.createElement('script');
  socketScript.src = `${api.replace(/\/api$/, '')}/socket.io/socket.io.js`;
  socketScript.onload = () => {
    if (!window.io) return;
    const socket = window.io(api.replace(/\/api$/, ''));
    socket.on('menu.updated', load);
    socket.on('menu.item-updated', load);
  };
  document.head.appendChild(socketScript);
})();
