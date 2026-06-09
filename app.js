/* ============================================================
   app.js — Customer App Logic for ماركت الكفيل
   Uses Supabase Realtime for instant updates
   ============================================================ */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────
  let cart = [];
  let menuData = [];
  let currentItem = null;
  let modalQty = 1;
  let modalAddons = [];
  let appliedPromo = null;
  let currentOrderId = localStorage.getItem('kafeel_active_order') || null;
  let hasActiveOrder = !!currentOrderId;
  let lastTrackedStatus = null;
  let cancelledInfo = null;   // { orderId, note, ts }
  let cancelledTimer = null;
  let currentCustomer = null; // { username, phone } when logged in
  let pendingCheckout = false; // user tried to checkout while logged out

  // ─── History / Back-Button Stack ────────────────────────────
  const historyStack = [];

  function historyPush(layer) {
    historyStack.push(layer);
    history.pushState({ layer }, '');
  }

  function historyCloseLayer(layer) {
    switch (layer) {
      case 'itemModal':  closeItemModal(true);  break;
      case 'cartDrawer': closeCart(true);        break;
      case 'checkout':   showScreen('#menuScreen', true); break;
      case 'tracking':   showScreen('#menuScreen', true); break;
      case 'sections':   showScreen('#menuScreen', true); break;
      case 'category':   currentCategory = null; showScreen('#menuScreen', true); break;
      case 'auth':       closeAuth(true); break;
    }
  }

  window.addEventListener('popstate', () => {
    const layer = historyStack.pop();
    if (layer) {
      historyCloseLayer(layer);
    }
  });

  // ─── DOM References ─────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const menuScreen = $('#menuScreen');
  const checkoutScreen = $('#checkoutScreen');
  const trackingScreen = $('#trackingScreen');
  const categoriesScroll = $('#categoriesScroll');
  const menuContent = $('#menuContent');
  const itemModal = $('#itemModal');
  const cartOverlay = $('#cartOverlay');
  const cartDrawer = $('#cartDrawer');
  const cartBody = $('#cartBody');
  const cartFooter = $('#cartFooter');
  const floatingCart = $('#floatingCart');

  // ─── Screen Navigation ─────────────────────────────────────
  function showScreen(screenId, fromPopstate) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(screenId).classList.add('active');
    window.scrollTo(0, 0);
    const shoppable = (screenId === '#menuScreen' || screenId === '#categoryScreen');
    floatingCart.style.display = (shoppable && cart.length > 0 && !hasActiveOrder) ? 'flex' : 'none';
    updateFloatingOrderCard();

    if (!fromPopstate && screenId !== '#menuScreen') {
      const layer = screenId === '#checkoutScreen' ? 'checkout'
                  : screenId === '#sectionsScreen' ? 'sections'
                  : screenId === '#categoryScreen' ? 'category'
                  : 'tracking';
      historyPush(layer);
    }
  }

  // Neutral, text-free placeholder for items/categories without a photo.
  const PH_ICON = '<svg class="ph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

  // Inline SVG icons (replacing emojis used in the UI)
  const SVG_CART  = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>';
  const SVG_NOTE  = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const SVG_TRASH = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
  const SVG_OK    = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  const SVG_ERR   = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  const SVG_TAG   = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
  const SVG_CAT   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>';

  // Dynamic section list — starts from the offline fallback, then is
  // replaced by the admin-managed `categories` table once loaded.
  let categoryList = CATEGORIES.map(n => ({
    name: n,
    image: (typeof CATEGORY_IMAGES !== 'undefined' && CATEGORY_IMAGES[n]) ? CATEGORY_IMAGES[n] : '',
  }));

  // ─── Render Categories (الأقسام cards) ──────────────────────
  function categoryCardHtml(c) {
    const media = c.image
      ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" class="cat-card-img" loading="lazy">`
      : `<div class="cat-card-ph">${PH_ICON}</div>`;
    return `
      <button type="button" class="cat-card" data-cat="${escapeHtml(c.name)}">
        ${media}
        <span class="cat-card-name">${escapeHtml(c.name)}</span>
      </button>`;
  }

  // Skeleton shimmer per image.
  // For item-img / modal-img the shimmer lives on the wrapper div, not the
  // <img> itself, so transparent areas don't bleed the shimmer through.
  function hydrateImg(img) {
    const wrap = img.parentElement;
    const isWrap = wrap && (
      wrap.classList.contains('item-img-wrap') ||
      wrap.classList.contains('modal-img-wrap')
    );
    const markLoaded = () => {
      img.classList.add('loaded');
      if (isWrap) wrap.classList.add('loaded');
    };
    if (img.complete && img.naturalWidth > 0) { markLoaded(); return; }
    img.addEventListener('load',  markLoaded, { once: true });
    img.addEventListener('error', markLoaded, { once: true });
  }
  function hydrateImages(container) {
    container.querySelectorAll('img.item-img, img.cat-card-img').forEach(hydrateImg);
  }

  // ─── Whole-page reveal ─────────────────────────────────────
  // Rather than letting each image pop in on its own, keep the loading
  // screen up until the homepage content AND all of its images have
  // finished loading, then reveal everything at once.
  let _revealed = false;
  function revealApp() {
    if (_revealed) return;
    _revealed = true;
    const loader = document.getElementById('loadingScreen');
    if (loader) loader.classList.add('hidden');
  }
  function revealWhenImagesReady(maxWaitMs) {
    if (_revealed) return;
    const scopes = [
      (typeof categoriesScroll !== 'undefined') ? categoriesScroll : null,
      document.getElementById('offersContainer'),
      (typeof menuContent !== 'undefined') ? menuContent : null,
    ];
    const pending = [];
    scopes.forEach(s => {
      if (!s) return;
      s.querySelectorAll('img').forEach(im => {
        if (!(im.complete && im.naturalWidth > 0)) pending.push(im);
      });
    });
    if (!pending.length) { revealApp(); return; }
    let remaining = pending.length;
    const done = () => { if (--remaining <= 0) revealApp(); };
    pending.forEach(im => {
      im.addEventListener('load', done, { once: true });
      im.addEventListener('error', done, { once: true });
    });
    // Safety net: never let a slow/broken image keep the page hidden.
    setTimeout(revealApp, maxWaitMs || 9000);
  }

  function wireCategoryCards(container) {
    container.querySelectorAll('.cat-card').forEach(card => {
      card.addEventListener('click', () => openCategoryPage(card.dataset.cat));
    });
    hydrateImages(container);
  }

  function renderCategories() {
    categoriesScroll.innerHTML = categoryList.map(categoryCardHtml).join('');
    wireCategoryCards(categoriesScroll);
  }

  // ─── All Sections Page (المزيد) ────────────────────────────
  function renderSectionsPage() {
    const grid = document.getElementById('sectionsGrid');
    if (!grid) return;
    grid.innerHTML = categoryList.map(categoryCardHtml).join('');
    wireCategoryCards(grid);
  }

  // Load admin-managed sections from the DB (falls back to static list).
  async function loadCategories() {
    try {
      const cats = await getCategories();
      if (cats && cats.length) {
        categoryList = cats;
        renderCategories();
        if (document.getElementById('sectionsScreen').classList.contains('active')) renderSectionsPage();
      }
    } catch (e) {}
  }

  // ─── Single Category Page ──────────────────────────────────
  let currentCategory = null;

  function wireItemCards(container) {
    container.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', () => {
        if (hasActiveOrder) return;
        const item = menuData.find(i => i.id === card.dataset.id);
        if (item && item.inStock) openItemModal(item);
      });
    });
    hydrateImages(container);
  }

  function renderCategoryPage(cat) {
    const grid = document.getElementById('categoryGrid');
    const titleEl = document.getElementById('categoryPageTitle');
    const iconEl = document.getElementById('categoryPageIcon');
    if (titleEl) titleEl.textContent = cat;
    if (iconEl) iconEl.innerHTML = SVG_CAT;
    if (!grid) return;
    const items = menuData.filter(i => i.category === cat);
    if (!items.length) {
      grid.innerHTML = '<p class="home-empty">لا توجد منتجات في هذا القسم بعد</p>';
      return;
    }
    grid.innerHTML = items.map(renderItemCard).join('');
    wireItemCards(grid);
  }

  function openCategoryPage(cat) {
    // if we came from the "all sections" page, drop that layer first
    const sIdx = historyStack.indexOf('sections');
    if (sIdx !== -1) historyStack.splice(sIdx, 1);
    currentCategory = cat;
    renderCategoryPage(cat);
    showScreen('#categoryScreen');
  }

  // ─── Render Menu / Homepage ─────────────────────────────────
  // The homepage no longer lists every product. It shows curated rows
  // (best sellers + admin-picked specials). Full product lists live on
  // each category's own page.
  function renderMenuFromCache() {
    renderOffersRow();
    renderHomeRows();
    if (currentCategory && document.getElementById('categoryScreen').classList.contains('active')) {
      renderCategoryPage(currentCategory);
    }
  }

  // SVG icons replacing the 🔥 / ⭐ emojis in the home-row titles
  const ICON_FIRE = '<svg class="home-row-icon" viewBox="0 0 24 24" fill="#3CA043" stroke="#3CA043" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>';
  const ICON_STAR = '<svg class="home-row-icon" viewBox="0 0 24 24" fill="#F4B400" stroke="#F4B400" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

  function homeRowHtml(iconSvg, title, items) {
    return `
      <section class="home-row">
        <div class="home-row-head"><h2 class="home-row-title">${iconSvg}<span>${title}</span></h2></div>
        <div class="home-scroll">${items.map(renderItemCard).join('')}</div>
      </section>`;
  }

  function renderHomeRows() {
    const inStock = menuData.filter(i => i.inStock);

    const best = inStock
      .filter(i => (i.salesCount || 0) > 0)
      .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
      .slice(0, 12);

    const special = inStock.filter(i => i.isSpecial);

    let html = '';
    if (best.length) html += homeRowHtml(ICON_FIRE, 'الأكثر مبيعاً', best);
    if (special.length) html += homeRowHtml(ICON_STAR, 'منتجات مميزة', special);
    if (!html) html = '<p class="home-empty">تصفّح الأقسام لعرض المنتجات</p>';

    menuContent.innerHTML = html;
    wireItemCards(menuContent);
  }

  // Format a product name: drop the "*" separator and style the trailing
  // size/quantity (e.g. "حليب مكثف *380 غرام" → name + a small size label).
  function formatProductName(name) {
    name = String(name || '');
    const idx = name.lastIndexOf('*');
    if (idx === -1) return escapeHtml(name);
    const main = name.slice(0, idx).trim();
    const size = name.slice(idx + 1).trim();
    if (size && /\d/.test(size)) {
      return escapeHtml(main) + ' <span class="item-size">' + escapeHtml(size) + '</span>';
    }
    return escapeHtml(name.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim());
  }

  // ─── Offers (per-product discounts) ─────────────────────────
  function isOnOffer(item) {
    return !!(item.offerPrice && item.offerPrice > 0 && item.offerPrice < item.price);
  }
  function effectivePrice(item) {
    return isOnOffer(item) ? item.offerPrice : item.price;
  }

  const ICON_TAG = '<svg class="home-row-icon" viewBox="0 0 24 24" fill="none" stroke="#3CA043" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';

  // The "العروض" row: products the admin has given a discounted price.
  function renderOffersRow() {
    const container = document.getElementById('offersContainer');
    if (!container) return;
    const items = menuData.filter(i => i.inStock && isOnOffer(i));
    if (!items.length) { container.innerHTML = ''; return; }
    container.innerHTML =
      '<section class="home-row offers-row">' +
        '<div class="home-row-head"><h2 class="home-row-title">' + ICON_TAG + '<span>العروض</span></h2></div>' +
        '<div class="home-scroll">' + items.map(renderItemCard).join('') + '</div>' +
      '</section>';
    wireItemCards(container);
  }

  async function loadAndRenderOffers() {
    renderOffersRow();
  }

  async function loadAndRenderMenu() {
    if (_menuCache && _menuCache.length && menuData.length === 0) {
      menuData = _menuCache;
      renderMenuFromCache();
    }

    const [menuResult, statusResult] = await Promise.allSettled([
      getMenu(),
      getRestaurantStatus(),
    ]);

    if (menuResult.status === 'fulfilled' && menuResult.value && menuResult.value.length) {
      const freshMenu = menuResult.value;
      if (JSON.stringify(freshMenu) !== JSON.stringify(menuData)) {
        menuData = freshMenu;
        renderMenuFromCache();
      }
    }

    if (statusResult.status === 'fulfilled') {
      const status = statusResult.value;
      if (status && status.success && !status.isOpen) {
        document.getElementById('closedOverlay').style.display = 'flex';
      }
    }

    await loadAndRenderOffers();
    // NOTE: the loading screen is hidden by the whole-page reveal in init()
    // (revealWhenImagesReady), once sections + menu + images are all ready.
  }

  function renderItemCard(item) {
    const imgHtml = item.image
      ? `<div class="item-img-wrap"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="item-img" loading="lazy"></div>`
      : `<div class="item-placeholder">${PH_ICON}</div>`;

    const onOffer = isOnOffer(item);
    const priceHtml = onOffer
      ? `<div class="item-price-wrap">
           <span class="price-old">${formatPrice(item.price)}</span>
           <span class="price-new">${formatPrice(item.offerPrice)}</span>
         </div>`
      : `<div class="item-price">${formatPrice(item.price)}</div>`;

    return `
      <div class="item-card ${item.inStock ? '' : 'out-of-stock'} ${onOffer ? 'has-offer' : ''}" data-id="${escapeHtml(item.id)}">
        ${imgHtml}
        ${onOffer ? '<span class="offer-tag">عرض</span>' : ''}
        <div class="item-info">
          <h3>${formatProductName(item.name)}</h3>
          ${priceHtml}
        </div>
        ${!item.inStock ? '<span class="stock-badge">نفد</span>' : ''}
        ${item.inStock ? '<button class="add-btn" aria-label="إضافة">+</button>' : ''}
      </div>
    `;
  }

  // ─── Item Modal ─────────────────────────────────────────────
  function openItemModal(item) {
    currentItem = item;
    modalQty = 1;
    modalAddons = [];

    $('#modalItemName').innerHTML = formatProductName(item.name);
    $('#modalItemDesc').textContent = item.description;
    $('#modalItemPrice').innerHTML = isOnOffer(item)
      ? `<span class="price-old">${formatPrice(item.price)}</span> <span class="price-new">${formatPrice(item.offerPrice)}</span>`
      : formatPrice(item.price);
    $('#qtyValue').textContent = '1';

    const imgContainer = $('#modalImageContainer');
    if (item.image) {
      imgContainer.innerHTML = `<div class="modal-img-wrap"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="modal-img"></div>`;
      const mi = imgContainer.querySelector('img.modal-img');
      if (mi) hydrateImg(mi);
    } else {
      imgContainer.innerHTML = `<div class="modal-img-placeholder">${PH_ICON}</div>`;
    }

    const addonsSection = $('#addonsSection');
    const addonsList = $('#addonsList');
    if (item.addons && item.addons.length > 0) {
      addonsSection.style.display = 'block';
      addonsList.innerHTML = item.addons.map(addon => `
        <div class="addon-item">
          <input type="checkbox" id="addon-${escapeHtml(addon.id)}" data-id="${escapeHtml(addon.id)}" data-price="${parseInt(addon.price) || 0}">
          <label for="addon-${escapeHtml(addon.id)}">${escapeHtml(addon.name)}</label>
          <span class="addon-price">+${formatPrice(addon.price)}</span>
        </div>
      `).join('');

      addonsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) {
            modalAddons.push({ id: cb.dataset.id, price: parseInt(cb.dataset.price) });
          } else {
            modalAddons = modalAddons.filter(a => a.id !== cb.dataset.id);
          }
          updateModalTotal();
        });
      });
    } else {
      addonsSection.style.display = 'none';
    }

    $('#modalNotes').value = '';
    updateModalTotal();
    itemModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    historyPush('itemModal');
  }

  function closeItemModal(fromPopstate) {
    itemModal.classList.remove('active');
    document.body.style.overflow = '';
    currentItem = null;
    if (!fromPopstate && historyStack[historyStack.length - 1] === 'itemModal') {
      // Only step back one entry: history.back() triggers popstate, whose
      // handler pops the stack and finalizes the close. Popping here too
      // would remove the underlying layer (e.g. the section), kicking the
      // user back to the main menu instead of the section they came from.
      history.back();
    }
  }

  function updateModalTotal() {
    if (!currentItem) return;
    const addonTotal = modalAddons.reduce((sum, a) => sum + a.price, 0);
    const total = (effectivePrice(currentItem) + addonTotal) * modalQty;
    $('#modalTotalPrice').textContent = formatPrice(total);
  }

  // ─── Cart Management ───────────────────────────────────────
  function addToCart() {
    if (!currentItem) return;
    const addonNames = [];
    const selectedAddons = [];
    if (currentItem.addons) {
      currentItem.addons.forEach(addon => {
        if (modalAddons.find(a => a.id === addon.id)) {
          selectedAddons.push({ ...addon });
          addonNames.push(addon.name);
        }
      });
    }
    const notes = $('#modalNotes').value.trim();
    const addonTotal = selectedAddons.reduce((sum, a) => sum + a.price, 0);

    cart.push({
      cartId: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      itemId: currentItem.id,
      name: currentItem.name,
      basePrice: effectivePrice(currentItem),
      addons: selectedAddons,
      addonNames: addonNames,
      notes: notes,
      qty: modalQty,
      unitPrice: effectivePrice(currentItem) + addonTotal,
    });

    closeItemModal();
    updateCartUI();
    showAddedFeedback();
  }

  function showAddedFeedback() {
    floatingCart.style.transform = 'translateX(-50%) scale(1.08)';
    setTimeout(() => { floatingCart.style.transform = 'translateX(-50%) scale(1)'; }, 200);
  }

  function removeFromCart(cartId) {
    cart = cart.filter(c => c.cartId !== cartId);
    updateCartUI();
    renderCartDrawer();
  }

  function updateCartItemQty(cartId, delta) {
    const item = cart.find(c => c.cartId === cartId);
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
    updateCartUI();
    renderCartDrawer();
  }

  function getCartSubtotal() {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }

  function getDiscount(subtotal) {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === 'percent') return Math.round(subtotal * appliedPromo.value / 100);
    if (appliedPromo.type === 'fixed') return Math.min(appliedPromo.value, subtotal);
    return 0;
  }

  function updateCartUI() {
    const count = cart.reduce((s, c) => s + c.qty, 0);
    const subtotal = getCartSubtotal();
    const deliveryFee = getDeliveryFee(subtotal);
    const shoppable = $('#menuScreen').classList.contains('active') || $('#categoryScreen').classList.contains('active');
    floatingCart.style.display = (cart.length > 0 && !hasActiveOrder && shoppable) ? 'flex' : 'none';
    $('#floatingCartBadge').textContent = count;
    $('#floatingCartTotal').textContent = formatPrice(subtotal + deliveryFee - getDiscount(subtotal));
  }

  // ─── Cart Drawer ────────────────────────────────────────────
  function openCart() {
    renderCartDrawer();
    cartOverlay.classList.add('active');
    cartDrawer.classList.add('active');
    floatingCart.style.display = 'none';
    document.body.style.overflow = 'hidden';
    historyPush('cartDrawer');
  }

  function closeCart(fromPopstate) {
    cartOverlay.classList.remove('active');
    cartDrawer.classList.remove('active');
    if (cart.length > 0) floatingCart.style.display = 'flex';
    document.body.style.overflow = '';
    if (!fromPopstate && historyStack[historyStack.length - 1] === 'cartDrawer') {
      // popstate handler does the single authoritative pop + close; popping
      // here too would unwind the underlying section back to the main menu.
      history.back();
    }
  }

  function renderCartDrawer() {
    if (cart.length === 0) {
      cartBody.innerHTML = `
        <div class="cart-empty">
          <div class="empty-icon">${SVG_CART}</div>
          <p>السلة فارغة</p>
          <p style="font-size:12px;color:var(--text-light);margin-top:4px;">أضف منتجاتك المفضلة!</p>
        </div>`;
      cartFooter.style.display = 'none';
      return;
    }

    cartBody.innerHTML = cart.map(item => `
      <div class="cart-item ${item.isOffer ? 'cart-item-offer' : ''}">
        <div class="cart-item-info">
          <h4>${item.isOffer ? SVG_TAG + ' ' : ''}${formatProductName(item.name)}</h4>
          ${item.addonNames && item.addonNames.length ? `<div class="cart-item-addons">+ ${item.addonNames.map(a => escapeHtml(a)).join('، ')}</div>` : ''}
          ${item.isOffer && item.notes ? `<div class="cart-item-offer-items">${escapeHtml(item.notes)}</div>` : ''}
          ${!item.isOffer && item.notes ? `<div class="cart-item-notes">${SVG_NOTE} ${escapeHtml(item.notes)}</div>` : ''}
          <div class="cart-item-qty">
            <button onclick="window._cartQty('${escapeHtml(item.cartId)}', -1)">−</button>
            <span>${item.qty}</span>
            <button onclick="window._cartQty('${escapeHtml(item.cartId)}', 1)">+</button>
          </div>
        </div>
        <div class="cart-item-price">${formatPrice(item.unitPrice * item.qty)}</div>
        <button class="cart-item-remove" onclick="window._cartRemove('${escapeHtml(item.cartId)}')">${SVG_TRASH}</button>
      </div>
    `).join('');

    const subtotal = getCartSubtotal();
    const deliveryFee = getDeliveryFee(subtotal);
    const discount = getDiscount(subtotal);
    const total = subtotal + deliveryFee - discount;
    const meetsMin = subtotal >= MIN_ORDER;

    let deliveryMsgHtml = '';
    if (subtotal < FREE_DELIVERY_THRESHOLD) {
      const remaining = FREE_DELIVERY_THRESHOLD - subtotal;
      deliveryMsgHtml = `<div class="delivery-msg delivery-msg-add">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        أضف بقيمة <strong>${formatPrice(remaining)}</strong> للحصول على توصيل مجاني
      </div>`;
    } else {
      deliveryMsgHtml = `<div class="delivery-msg delivery-msg-free">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        مبروك! حصلت على توصيل مجاني
      </div>`;
    }

    let summaryHtml = deliveryMsgHtml;
    summaryHtml += `
      <div class="cart-summary-row"><span>المجموع الفرعي</span><span>${formatPrice(subtotal)}</span></div>
      <div class="cart-summary-row"><span>رسوم التوصيل</span><span>${deliveryFee === 0 ? '<span class="free-delivery-label">مجاني</span>' : formatPrice(deliveryFee)}</span></div>
    `;
    if (discount > 0) {
      summaryHtml += `<div class="cart-summary-row"><span class="discount">الخصم (${appliedPromo.code})</span><span class="discount">-${formatPrice(discount)}</span></div>`;
    }
    summaryHtml += `<div class="cart-summary-row total"><span>الإجمالي</span><span>${formatPrice(total)}</span></div>`;
    $('#cartSummaryRows').innerHTML = summaryHtml;

    $('#goCheckout').disabled = !meetsMin;
    $('#minOrderMsg').textContent = meetsMin ? '' : `الحد الأدنى للطلب ${formatPrice(MIN_ORDER)}`;
    cartFooter.style.display = 'block';
  }

  window._cartRemove = removeFromCart;
  window._cartQty = updateCartItemQty;

  // ─── Promo Code ─────────────────────────────────────────────
  async function applyPromo() {
    const code = $('#promoInput').value.trim();
    const promoMsg = $('#promoMsg');
    if (!code) return;

    promoMsg.textContent = '...جاري التحقق';
    promoMsg.className = 'promo-msg';

    const promo = await validatePromoCode(code);
    if (promo) {
      appliedPromo = promo;
      promoMsg.innerHTML = SVG_OK + ' تم تطبيق كود الخصم بنجاح!';
      promoMsg.className = 'promo-msg success';
    } else {
      appliedPromo = null;
      promoMsg.innerHTML = SVG_ERR + ' كود الخصم غير صالح';
      promoMsg.className = 'promo-msg error';
    }
    renderCartDrawer();
    updateCartUI();
  }

  function goToCheckout() {
    // Open checkout for everyone — the customer just enters their phone here.
    // (Login/registration is set aside for now.)
    cartOverlay.classList.remove('active');
    cartDrawer.classList.remove('active');
    document.body.style.overflow = '';
    const cartIdx = historyStack.indexOf('cartDrawer');
    if (cartIdx !== -1) historyStack.splice(cartIdx, 1);

    const saved = JSON.parse(localStorage.getItem('kafeel_customer') || '{}');
    // Prefill from the last order placed on this device.
    $('#customerPhone').value = saved.phone || '';
    if (saved.address) $('#customerAddress').value = saved.address;
    $('#customerName').value = saved.name || '';

    renderCheckoutSummary();
    showScreen('#checkoutScreen');
  }

  function renderCheckoutSummary() {
    const subtotal = getCartSubtotal();
    const deliveryFee = getDeliveryFee(subtotal);
    const discount = getDiscount(subtotal);
    const total = subtotal + deliveryFee - discount;

    let html = '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px;">ملخص الطلب</h3>';
    cart.forEach(item => {
      html += `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span>${escapeHtml(item.name)} × ${item.qty}</span>
        <span>${formatPrice(item.unitPrice * item.qty)}</span>
      </div>`;
    });
    html += `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:var(--text-muted);">
      <span>رسوم التوصيل</span>
      <span>${deliveryFee === 0 ? '<span style="color:var(--success);font-weight:600;">مجاني</span>' : formatPrice(deliveryFee)}</span>
    </div>`;
    if (discount > 0) {
      html += `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:var(--success);">
        <span>الخصم (${appliedPromo.code})</span>
        <span>-${formatPrice(discount)}</span>
      </div>`;
    }
    html += `<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700;">
      <span>الإجمالي</span>
      <span style="color:var(--primary)">${formatPrice(total)}</span>
    </div>`;
    $('#checkoutSummary').innerHTML = html;
  }

  async function submitOrder(e) {
    e.preventDefault();
    let valid = true;
    const phone = $('#customerPhone').value.trim();
    const address = $('#customerAddress').value.trim();
    const name = $('#customerName').value.trim();

    if (!validatePhone(phone)) {
      $('#customerPhone').classList.add('error');
      $('#phoneError').classList.add('visible');
      valid = false;
    } else {
      $('#customerPhone').classList.remove('error');
      $('#phoneError').classList.remove('visible');
    }

    if (!address) {
      $('#customerAddress').classList.add('error');
      $('#addressError').classList.add('visible');
      valid = false;
    } else {
      $('#customerAddress').classList.remove('error');
      $('#addressError').classList.remove('visible');
    }

    if (!name) {
      $('#customerName').classList.add('error');
      $('#nameError').classList.add('visible');
      valid = false;
    } else {
      $('#customerName').classList.remove('error');
      $('#nameError').classList.remove('visible');
    }

    if (!valid) return;

    const submitBtn = $('#submitOrder');
    submitBtn.disabled = true;
    submitBtn.textContent = '...جاري الإرسال';

    // Build items for server-side validation (prices are looked up server-side)
    const orderItems = cart.map(function (c) {
      return {
        item_id: c.itemId,
        qty: c.qty,
        addon_ids: (c.addons || []).map(function (a) { return a.id; }),
        notes: c.notes || '',
      };
    });

    const result = await saveOrder({
      name: name,
      phone: phone,
      address: address,
      items: orderItems,
      promoCode: appliedPromo ? appliedPromo.code : null,
    });

    if (!result.success) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'تأكيد الطلب';
      var errMsg = result.error || '';
      if (errMsg.indexOf('invalid_phone') !== -1) {
        $('#customerPhone').classList.add('error');
        $('#phoneError').classList.add('visible');
        alert('رقم الهاتف غير صالح. يرجى إدخال رقم عراقي صحيح');
      } else if (errMsg.indexOf('item_unavailable') !== -1) {
        alert('بعض الأصناف لم تعد متوفرة. يرجى تحديث السلة');
      } else if (errMsg.indexOf('offer_expired') !== -1) {
        alert('العرض انتهت صلاحيته. يرجى إزالته من السلة');
      } else if (errMsg.indexOf('minimum_not_met') !== -1) {
        alert('لم يتم تحقيق الحد الأدنى للطلب');
      } else {
        alert('حدث خطأ أثناء إرسال الطلب. يرجى المحاولة مرة أخرى');
      }
      console.error('Order submit failed:', errMsg);
      return;
    }

    dismissCancelledCard();
    var serverOrder = result.data;
    console.log('Order created:', serverOrder);

    currentOrderId = serverOrder.id;
    hasActiveOrder = true;
    lastTrackedStatus = 'pending';
    localStorage.setItem('kafeel_active_order', serverOrder.id);

    localStorage.setItem('kafeel_customer', JSON.stringify({ phone, address, name }));
    cart = [];
    appliedPromo = null;
    updateCartUI();

    submitBtn.disabled = false;
    submitBtn.textContent = 'تأكيد الطلب';
    $('#checkoutForm').reset();

    const fcmToken = getFCMToken();
    if (fcmToken) {
      savePushToken(serverOrder.id, fcmToken).catch(function () {});
    }

    sendPushNotification(serverOrder.id, 'new_order');

    updateFloatingOrderStatus('pending');
    showScreen('#trackingScreen');
    $('#trackingOrderId').textContent = 'رقم الطلب: ' + serverOrder.id;
    hideOrderCompleted();
    updateTrackingTimeline('pending');
    startTrackingRealtime();
  }

  // ─── Order Tracking (Realtime) ─────────────────────────────
  const STATUS_ORDER = ['pending', 'cooking', 'delivery'];

  function updateTrackingTimeline(currentStatus) {
    if (currentStatus === 'cancelled') {
      $$('.timeline-step').forEach(step => {
        step.classList.remove('active', 'completed');
      });
      return;
    }
    const currentIdx = STATUS_ORDER.indexOf(currentStatus);
    $$('.timeline-step').forEach((step, i) => {
      step.classList.remove('active', 'completed');
      if (i < currentIdx) step.classList.add('completed');
      else if (i === currentIdx) step.classList.add('active');
    });
  }

  function startTrackingRealtime() {
    if (!currentOrderId) return;

    subscribeToOrder(currentOrderId, function (result) {
      if (!result || result.status === 'not_found') {
        clearTrackingState();
        return;
      }

      const status = result.status;

      updateFloatingOrderStatus(status);

      if ($('#trackingScreen').classList.contains('active')) {
        updateTrackingTimeline(status);
      }

      if (status === 'cancelled') {
        const note = result.cancelNote || '';
        var cancelOrderId = currentOrderId;
        showOrderCancelled(note);
        clearTrackingStateKeepScreen();
        setCancelledCard(cancelOrderId, note);
        return;
      }

      lastTrackedStatus = status;

      if (status === 'done') {
        clearTrackingState();
      }
    });
  }

  function clearTrackingState() {
    unsubscribeFromOrder();
    currentOrderId = null;
    hasActiveOrder = false;
    lastTrackedStatus = null;
    localStorage.removeItem('kafeel_active_order');
    updateFloatingOrderCard();
    if ($('#trackingScreen').classList.contains('active')) {
      updateTrackingTimeline('done');
      showOrderCompleted();
    }
    floatingCart.style.display = cart.length > 0 ? 'flex' : 'none';
  }

  function clearTrackingStateKeepScreen() {
    unsubscribeFromOrder();
    currentOrderId = null;
    hasActiveOrder = false;
    lastTrackedStatus = null;
    localStorage.removeItem('kafeel_active_order');
    updateFloatingOrderCard();
    floatingCart.style.display = cart.length > 0 ? 'flex' : 'none';
  }

  function showOrderCompleted() {
    $$('.timeline-step').forEach(step => {
      step.classList.remove('active');
      step.classList.add('completed');
    });
    $('#orderDoneMsg').style.display = 'block';
    $('#newOrderBtn').style.display = 'block';
    $('#orderCancelledMsg').style.display = 'none';
  }

  function showOrderCancelled(note) {
    $('#orderDoneMsg').style.display = 'none';
    const cancelMsg = $('#orderCancelledMsg');
    cancelMsg.style.display = 'block';
    const cancelNote = $('#cancelNote');
    cancelNote.textContent = note || '';
    cancelNote.style.display = note ? 'block' : 'none';
    $('#newOrderBtn').style.display = 'block';
    updateTrackingTimeline('cancelled');
  }

  function hideOrderCompleted() {
    $('#orderDoneMsg').style.display = 'none';
    $('#newOrderBtn').style.display = 'none';
    $('#orderCancelledMsg').style.display = 'none';
  }

  // ─── Menu Realtime Sync ───────────────────────────────────
  function startMenuRealtime() {
    subscribeToMenu(async function () {
      const freshMenu = await fetchMenuFresh();
      if (freshMenu && freshMenu.length) {
        menuData = freshMenu;
        renderMenuFromCache();
      }
    });
    subscribeToOffers(function () {
      loadAndRenderOffers();
    });
  }

  // ─── Floating Order Card ──────────────────────────────────
  const STATUS_ICONS = {
    pending:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    cooking:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>',
    delivery:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    done:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    cancelled: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  const STATUS_TEXTS = {
    pending:   'قيد الانتظار',
    cooking:   'جاري التجهيز',
    delivery:  'في الطريق',
    done:      'تم التسليم',
    cancelled: 'تم الإلغاء',
  };

  function updateFloatingOrderCard() {
    const card = $('#floatingOrderCard');
    if (!card) return;
    const menuActive = $('#menuScreen').classList.contains('active');

    // Cancelled card takes priority (persists until dismissed)
    if (cancelledInfo && menuActive) {
      card.style.display = 'flex';
      card.classList.add('foc-cancelled-mode');
      $('#focOrderId').textContent = cancelledInfo.orderId;
      var titleEl = card.querySelector('.foc-title');
      if (titleEl) titleEl.textContent = 'تم إلغاء طلبك';
      updateFloatingOrderStatus('cancelled');
      return;
    }

    // Normal active order
    card.classList.remove('foc-cancelled-mode');
    var titleEl2 = card.querySelector('.foc-title');
    if (titleEl2) titleEl2.textContent = 'طلبك الحالي';
    if (hasActiveOrder && currentOrderId && menuActive) {
      card.style.display = 'flex';
      $('#focOrderId').textContent = currentOrderId;
    } else {
      card.style.display = 'none';
    }
  }

  function setCancelledCard(orderId, note) {
    cancelledInfo = { orderId: orderId, note: note || '', ts: Date.now() };
    try { localStorage.setItem('kafeel_cancelled_info', JSON.stringify(cancelledInfo)); } catch (e) {}
    if (cancelledTimer) clearTimeout(cancelledTimer);
    cancelledTimer = setTimeout(dismissCancelledCard, 15 * 60 * 1000);
    updateFloatingOrderCard();
  }

  function dismissCancelledCard() {
    cancelledInfo = null;
    try { localStorage.removeItem('kafeel_cancelled_info'); } catch (e) {}
    if (cancelledTimer) { clearTimeout(cancelledTimer); cancelledTimer = null; }
    updateFloatingOrderCard();
  }

  function updateFloatingOrderStatus(status) {
    const el = $('#focStatus');
    if (el) el.innerHTML = (STATUS_ICONS[status] || '') + ' ' + (STATUS_TEXTS[status] || status);
    const dot = document.querySelector('.foc-dot');
    if (dot) {
      dot.className = 'foc-dot';
      if (status === 'cooking') dot.classList.add('cooking');
      else if (status === 'delivery') dot.classList.add('delivery');
      else if (status === 'done') dot.classList.add('done');
      else if (status === 'cancelled') dot.classList.add('cancelled');
    }
  }

  // ─── Customer Auth (login / register / reset) ──────────────
  const authOverlay = $('#authOverlay');

  function updateAuthUI() {
    const headerAuth = $('#headerAuth');
    const accountWrap = $('#accountWrap');
    if (currentCustomer) {
      if (headerAuth) headerAuth.style.display = 'none';
      if (accountWrap) accountWrap.style.display = 'block';
      const nameEl = $('#accountName');
      if (nameEl) nameEl.textContent = currentCustomer.username || 'حسابي';
      const phEl = $('#accountMenuPhone');
      if (phEl) phEl.textContent = currentCustomer.phone || '';
    } else {
      // Auth is set aside — keep the header login/register buttons hidden.
      if (headerAuth) headerAuth.style.display = 'none';
      if (accountWrap) accountWrap.style.display = 'none';
      const menu = $('#accountMenu');
      if (menu) menu.style.display = 'none';
    }
  }

  function clearAuthErrors() {
    ['loginErr', 'regErr', 'resetErr'].forEach(id => {
      const el = $('#' + id);
      if (el) { el.textContent = ''; el.classList.remove('visible'); }
    });
  }

  function showAuthError(id, msg) {
    const el = $('#' + id);
    if (el) { el.textContent = msg; el.classList.add('visible'); }
  }

  function switchAuthView(view) {
    clearAuthErrors();
    $$('.auth-form').forEach(f => f.classList.toggle('active', f.dataset.authView === view));
    const tabs = $('#authTabs');
    if (view === 'reset') {
      if (tabs) tabs.style.display = 'none';
    } else {
      if (tabs) tabs.style.display = 'flex';
      $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === view));
    }
  }

  function openAuth(view) {
    switchAuthView(view || 'login');
    authOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    historyPush('auth');
  }

  function closeAuth(fromPopstate) {
    authOverlay.classList.remove('active');
    document.body.style.overflow = '';
    clearAuthErrors();
    if (!fromPopstate && historyStack[historyStack.length - 1] === 'auth') {
      // popstate handler does the single authoritative pop + close; popping
      // here too would unwind the underlying section back to the main menu.
      history.back();
    }
  }

  function setLoggedIn(customer) {
    currentCustomer = customer;
    updateAuthUI();
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearAuthErrors();
    const identifier = $('#loginIdentifier').value.trim();
    const password = $('#loginPassword').value;
    if (!identifier || !password) { showAuthError('loginErr', 'يرجى ملء جميع الحقول'); return; }
    const btn = $('#loginSubmit');
    btn.disabled = true; btn.textContent = '...جاري الدخول';
    const res = await loginCustomer(identifier, password);
    btn.disabled = false; btn.textContent = 'دخول';
    if (!res.success) { showAuthError('loginErr', res.error); return; }
    setLoggedIn(res.customer);
    closeAuth();
    $('#custLoginForm').reset();
    if (pendingCheckout) { pendingCheckout = false; goToCheckout(); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    clearAuthErrors();
    const username = $('#regUsername').value.trim();
    const phone = $('#regPhone').value.trim();
    const password = $('#regPassword').value;
    if (!username || !phone || !password) { showAuthError('regErr', 'يرجى ملء جميع الحقول'); return; }
    if (!normalizeIraqiPhone(phone)) { showAuthError('regErr', 'رقم الهاتف غير صالح. مثال: 7XX XXX XXXX'); return; }
    if (password.length < 6) { showAuthError('regErr', 'كلمة المرور 6 أحرف على الأقل'); return; }
    const btn = $('#regSubmit');
    btn.disabled = true; btn.textContent = '...جاري الإنشاء';
    const res = await registerCustomer(username, phone, password);
    btn.disabled = false; btn.textContent = 'إنشاء الحساب';
    if (!res.success) { showAuthError('regErr', res.error); return; }
    setLoggedIn(res.customer);
    closeAuth();
    $('#custRegisterForm').reset();
    if (pendingCheckout) { pendingCheckout = false; goToCheckout(); }
  }

  async function handleReset(e) {
    e.preventDefault();
    clearAuthErrors();
    const phone = $('#resetPhone').value.trim();
    const newPassword = $('#resetNewPassword').value;
    if (!normalizeIraqiPhone(phone)) { showAuthError('resetErr', 'رقم الهاتف غير صالح'); return; }
    if (newPassword.length < 6) { showAuthError('resetErr', 'كلمة المرور 6 أحرف على الأقل'); return; }
    const btn = $('#resetSubmit');
    btn.disabled = true; btn.textContent = '...جاري المعالجة';
    // OTP is not wired yet — the server rejects with otp_required, which we
    // surface as a friendly "coming soon" message.
    const res = await resetCustomerPassword(phone, '', newPassword);
    btn.disabled = false; btn.textContent = 'تحديث كلمة المرور';
    if (!res.success) { showAuthError('resetErr', res.error); return; }
    showAuthError('resetErr', '');
    switchAuthView('login');
  }

  async function handleLogout() {
    await logoutCustomer();
    currentCustomer = null;
    updateAuthUI();
  }

  function wireAuth() {
    $('#openLoginBtn').addEventListener('click', () => openAuth('login'));
    $('#openRegisterBtn').addEventListener('click', () => openAuth('register'));
    $('#authClose').addEventListener('click', () => closeAuth());
    authOverlay.addEventListener('click', (e) => { if (e.target === authOverlay) closeAuth(); });

    $$('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => switchAuthView(tab.dataset.authTab));
    });
    $('#gotoReset').addEventListener('click', () => switchAuthView('reset'));
    $('#backToLogin').addEventListener('click', () => switchAuthView('login'));

    $$('.auth-pass-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.target);
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    });

    $('#custLoginForm').addEventListener('submit', handleLogin);
    $('#custRegisterForm').addEventListener('submit', handleRegister);
    $('#custResetForm').addEventListener('submit', handleReset);

    // Account dropdown + logout
    const accountChip = $('#accountChip');
    const accountMenu = $('#accountMenu');
    if (accountChip) {
      accountChip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (accountMenu) accountMenu.style.display = accountMenu.style.display === 'none' ? 'block' : 'none';
      });
    }
    document.addEventListener('click', () => { if (accountMenu) accountMenu.style.display = 'none'; });
    if (accountMenu) accountMenu.addEventListener('click', (e) => e.stopPropagation());
    $('#logoutBtn').addEventListener('click', handleLogout);

    // Restore an existing session — disabled while login/registration is set
    // aside (guest checkout only). Re-enable with the header auth UI later.
    // getCustomerSession().then(cust => { if (cust) setLoggedIn(cust); });
  }

  // ─── Event Listeners ───────────────────────────────────────
  async function init() {
    renderCategories();
    wireAuth();
    subscribeToCategories(loadCategories);

    // Render cached content instantly, but keep it behind the loading
    // screen — the whole page is revealed at once only when ready.
    if (_menuCache && _menuCache.length) {
      menuData = _menuCache;
      renderMenuFromCache();
    }

    startMenuRealtime();

    // Wait for the first real data (sections + menu + offers) to render,
    // then reveal the page once all of its images have finished loading.
    Promise.allSettled([loadCategories(), loadAndRenderMenu()])
      .then(() => revealWhenImagesReady());
    // Global safety: reveal regardless after a few seconds (slow network).
    setTimeout(revealApp, 12000);

    initFirebaseMessaging().catch(() => {});

    // ─── Restore active order tracking ──────────────────────
    if (currentOrderId) {
      hasActiveOrder = true;
      getOrderStatusFull(currentOrderId).then(result => {
        if (result && result.status !== 'not_found') {
          if (result.status === 'cancelled') {
            var cancelId = currentOrderId;
            showScreen('#trackingScreen');
            $('#trackingOrderId').textContent = 'رقم الطلب: ' + cancelId;
            showOrderCancelled(result.cancelNote || '');
            clearTrackingStateKeepScreen();
            setCancelledCard(cancelId, result.cancelNote || '');
            return;
          }
          if (result.status === 'done') {
            clearTrackingState();
            return;
          }
          lastTrackedStatus = result.status;
          updateFloatingOrderStatus(result.status);
          updateFloatingOrderCard();
        } else {
          clearTrackingState();
        }
      }).catch(() => {
        updateFloatingOrderCard();
      });
      startTrackingRealtime();
    }

    // ─── Restore cancelled card from localStorage ───────────
    if (!currentOrderId) {
      try {
        var saved = JSON.parse(localStorage.getItem('kafeel_cancelled_info') || 'null');
        if (saved && saved.ts) {
          var elapsed = Date.now() - saved.ts;
          if (elapsed < 15 * 60 * 1000) {
            cancelledInfo = saved;
            cancelledTimer = setTimeout(dismissCancelledCard, (15 * 60 * 1000) - elapsed);
            updateFloatingOrderCard();
          } else {
            localStorage.removeItem('kafeel_cancelled_info');
          }
        }
      } catch (e) {}
    }

    $('#floatingOrderCard').addEventListener('click', function (e) {
      if (e.target.closest('#focCloseBtn')) return;

      if (cancelledInfo) {
        showScreen('#trackingScreen');
        $('#trackingOrderId').textContent = 'رقم الطلب: ' + cancelledInfo.orderId;
        updateTrackingTimeline('cancelled');
        showOrderCancelled(cancelledInfo.note || '');
        return;
      }

      if (!currentOrderId) return;
      showScreen('#trackingScreen');
      $('#trackingOrderId').textContent = 'رقم الطلب: ' + currentOrderId;
      hideOrderCompleted();
      if (lastTrackedStatus) updateTrackingTimeline(lastTrackedStatus);
    });

    $('#focCloseBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      dismissCancelledCard();
    });

    itemModal.addEventListener('click', (e) => { if (e.target === itemModal) closeItemModal(); });
    $('#qtyMinus').addEventListener('click', () => {
      modalQty = Math.max(1, modalQty - 1);
      $('#qtyValue').textContent = modalQty;
      updateModalTotal();
    });
    $('#qtyPlus').addEventListener('click', () => {
      modalQty++;
      $('#qtyValue').textContent = modalQty;
      updateModalTotal();
    });
    $('#modalAddToCart').addEventListener('click', addToCart);

    floatingCart.addEventListener('click', openCart);
    cartOverlay.addEventListener('click', closeCart);
    $('#cartClose').addEventListener('click', closeCart);
    $('#promoApply').addEventListener('click', applyPromo);
    $('#goCheckout').addEventListener('click', goToCheckout);

    $('#backToMenu').addEventListener('click', () => {
      if (historyStack[historyStack.length - 1] === 'checkout') {
        historyStack.pop();
        history.back();
      }
      showScreen('#menuScreen', true);
    });

    // ─── Categories "المزيد" → all-sections page ────────────
    $('#categoriesMore').addEventListener('click', () => {
      renderSectionsPage();
      showScreen('#sectionsScreen');
    });

    $('#sectionsBack').addEventListener('click', () => {
      if (historyStack[historyStack.length - 1] === 'sections') {
        historyStack.pop();
        history.back();
      }
      showScreen('#menuScreen', true);
    });

    $('#categoryBack').addEventListener('click', () => {
      if (historyStack[historyStack.length - 1] === 'category') {
        historyStack.pop();
        history.back();
      }
      currentCategory = null;
      showScreen('#menuScreen', true);
    });

    $('#trackingBackToMenu').addEventListener('click', () => {
      showScreen('#menuScreen');
    });

    $('#checkoutForm').addEventListener('submit', submitOrder);

    $('#customerPhone').addEventListener('input', () => {
      // Keep digits only — the customer enters the bare local number (e.g. 0770xxxxxxx).
      const el = $('#customerPhone');
      const digits = el.value.replace(/[^\d]/g, '').slice(0, 11);
      if (el.value !== digits) el.value = digits;
      el.classList.remove('error');
      $('#phoneError').classList.remove('visible');
    });
    $('#customerAddress').addEventListener('input', () => {
      $('#customerAddress').classList.remove('error');
      $('#addressError').classList.remove('visible');
    });
    $('#customerName').addEventListener('input', () => {
      $('#customerName').classList.remove('error');
      $('#nameError').classList.remove('visible');
    });

    $('#newOrderBtn').addEventListener('click', () => {
      currentOrderId = null;
      hasActiveOrder = false;
      lastTrackedStatus = null;
      localStorage.removeItem('kafeel_active_order');
      unsubscribeFromOrder();
      hideOrderCompleted();
      dismissCancelledCard();
      showScreen('#menuScreen');
    });
  }

  init();
})();
