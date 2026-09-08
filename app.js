const C = window.WAREHOUSE_CONFIG || {};

const configured =
  /^https:\/\//i.test(C.SUPABASE_URL || '') &&
  !!C.SUPABASE_ANON_KEY &&
  !String(C.SUPABASE_URL).includes('PASTE') &&
  !String(C.SUPABASE_ANON_KEY).includes('PASTE');

const sb =
  configured && window.supabase
    ? supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY)
    : null;

let products = [];
let activities = [];
let user = null;
let isAdmin = false;
let currentPage = 'dashboard';
let realtimeChannel = null;

const $ = id => document.getElementById(id);
const view = $('view');

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c]));

const fallback =
  'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1000&q=85';

const safeImg = s =>
  s && /^https?:\/\//i.test(s) ? s : fallback;

function toast(msg, kind = '') {
  const t = $('toast');
  if (!t) return;

  t.textContent = msg;
  t.className = 'toast show ' + kind;

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    t.className = 'toast';
  }, 3400);
}

function busy(btn, on, label = 'Saving…') {
  if (!btn) return;

  btn.disabled = on;

  if (on) {
    btn.dataset.old = btn.textContent;
    btn.textContent = label;
  } else {
    btn.textContent = btn.dataset.old || btn.textContent;
  }
}

function setConnection(ok) {
  if ($('liveDot')) {
    $('liveDot').classList.toggle('offline', !ok);
  }

  if ($('statusText')) {
    $('statusText').textContent = ok ? 'Live' : 'Connecting';
  }
}

async function boot() {
  if (!sb) {
    renderSetup();
    return;
  }

  try {
    const r = await sb.auth.getSession();

    user = r.data.session?.user || null;

    await refreshAuth();

    setConnection(true);
  } catch (e) {
    toast(e.message, 'error');
  }

  sb.auth.onAuthStateChange(async (_e, s) => {
    user = s?.user || null;

    await refreshAuth();

    updateAuth();
    render();
  });

  subscribeRealtime();

  await loadAll();

  render();
}

async function refreshAuth() {
  isAdmin = false;

  if (user) {
    const r = await sb
      .from('admin_users')
      .select('user_id,email')
      .eq('user_id', user.id)
      .maybeSingle();

    isAdmin = !!r.data && !r.error;
  }

  updateAuth();
}

function updateAuth() {
  if ($('hello')) {
    $('hello').textContent = user
      ? (isAdmin
          ? `Admin · ${user.email}`
          : `Signed in · ${user.email}`)
      : 'Public inventory';
  }

  if ($('avatar')) {
    $('avatar').textContent =
      (user?.email || 'W').slice(0, 1).toUpperCase();
  }

  if ($('logout')) {
    $('logout').classList.toggle('hidden', !user);
  }

  if ($('adminQuick')) {
    $('adminQuick').textContent =
      isAdmin ? 'Admin Control Center' : 'Admin Sign In';
  }
}

async function loadAll() {
  const [p, a] = await Promise.all([
    sb
      .from('products')
      .select('*')
      .order('created_at', { ascending: false }),

    sb
      .from('activity')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60)
  ]);

  if (p.error) {
    toast(p.error.message, 'error');
  } else {
    products = p.data || [];
  }

  if (!a.error) {
    activities = a.data || [];
  }
}

function subscribeRealtime() {
  realtimeChannel = sb
    .channel('warehouse-live')

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'products'
      },
      async () => {
        await loadAll();
        render();
        setConnection(true);
      }
    )

    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'activity'
      },
      async () => {
        const a = await sb
          .from('activity')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(60);

        activities = a.data || [];

        if (currentPage === 'activity') {
          render();
        }
      }
    )

    .subscribe(status => {
      setConnection(status === 'SUBSCRIBED');
    });
}

function renderSetup() {
  view.innerHTML = `
    <section class="hero setup">

      <span class="eyebrow">
        ONE-TIME CONNECTION
      </span>

      <h1>
        Your warehouse.<br>
        <em>Live.</em>
      </h1>

      <p>
        Add your Supabase URL and anon/publishable key in
        <b>config.js</b>.
        The included schema creates products, admin security,
        storage and the audit trail.
      </p>

      <div class="setup-grid">

        <div class="panel glass">
          <b>01</b>
          <h3>Supabase Free</h3>
          <p>Database + Auth + Storage.</p>
        </div>

        <div class="panel glass">
          <b>02</b>
          <h3>Admin protected</h3>
          <p>Only your approved user can write.</p>
        </div>

        <div class="panel glass">
          <b>03</b>
          <h3>GitHub Pages</h3>
          <p>Static hosting. No paid server.</p>
        </div>

      </div>

    </section>
  `;
}

function render() {
  document
    .querySelectorAll('.sidebar nav button')
    .forEach(b => {
      b.classList.toggle(
        'active',
        b.dataset.page === currentPage
      );
    });

  if (currentPage === 'dashboard') {
    dashboard();
  } else if (currentPage === 'inventory') {
    inventory();
  } else if (currentPage === 'activity') {
    activity();
  } else if (currentPage === 'admin') {
    admin();
  }
}

function dashboard() {
  const total = products.reduce(
    (n, p) => n + Number(p.quantity || 0),
    0
  );

  const low = products.filter(
    p => Number(p.quantity || 0) <= 7
  ).length;

  const cats = new Set(
    products.map(p => p.category).filter(Boolean)
  ).size;

  const locs = new Set(
    products.map(p => p.location).filter(Boolean)
  ).size;

  view.innerHTML = `
    <section class="hero">

      <span class="eyebrow">
        WAREHOUSE · LIVE OVERVIEW
      </span>

      <h1>
        Everything<br>
        <em>in one place.</em>
      </h1>

      <p>
        One clean public catalog for your stock.
        Inventory stays visible to everyone while
        management remains private to your administrator account.
      </p>

      <div class="hero-actions">

        <button
          class="primary"
          onclick="go('inventory')"
        >
          Browse inventory
          <span>→</span>
        </button>

        ${
          isAdmin
            ? `
              <button
                class="ghost"
                onclick="go('admin')"
              >
                Open control center
              </button>
            `
            : `
              <button
                class="ghost"
                onclick="loginDialog.showModal()"
              >
                Admin sign in
              </button>
            `
        }

      </div>

    </section>

    <section class="stats">

      <div class="stat glass">
        <small>Total units</small>
        <b>${total.toLocaleString()}</b>
        <span>all stock combined</span>
      </div>

      <div class="stat glass">
        <small>Products</small>
        <b>${products.length}</b>
        <span>unique items</span>
      </div>

      <div class="stat glass">
        <small>Low stock</small>
        <b>${low}</b>
        <span>
          ${low ? 'needs attention' : 'everything healthy'}
        </span>
      </div>

      <div class="stat glass">
        <small>Locations</small>
        <b>${locs}</b>
        <span>${cats} categories</span>
      </div>

    </section>

    <section class="content">

      <div class="panel glass">

        <div class="head">

          <div>
            <small class="section-label">
              LATEST
            </small>

            <h2>
              Recently added
            </h2>
          </div>

          <button
            class="textbtn"
            onclick="go('inventory')"
          >
            View all →
          </button>

        </div>

        ${
          products
            .slice(0, 6)
            .map(itemRow)
            .join('') ||
          empty(
            'No products yet',
            'Your first item will appear here.'
          )
        }

      </div>

      <div class="panel glass">

        <div class="head">

          <div>
            <small class="section-label">
              STOCK HEALTH
            </small>

            <h2>
              Needs attention
            </h2>
          </div>

          <span class="pill">
            ${low ? low + ' low' : 'All good'}
          </span>

        </div>

        <div class="health">

          ${
            products
              .filter(p => Number(p.quantity || 0) <= 7)
              .slice(0, 6)
              .map(
                p => `
                  <div class="health-row">

                    <span class="health-dot"></span>

                    <div>
                      <b>${esc(p.name)}</b>

                      <small>
                        ${Number(p.quantity || 0)} units ·
                        ${esc(p.location)}
                      </small>
                    </div>

                  </div>
                `
              )
              .join('') ||
            `
              <div class="healthy">

                <span>✓</span>

                <div>
                  <b>Everything looks good</b>

                  <small>
                    No item is at or below 7 units.
                  </small>
                </div>

              </div>
            `
          }

        </div>

      </div>

    </section>
  `;
}

function itemRow(p) {
  return `
    <div class="item">

      <img
        class="thumb"
        src="${safeImg(p.image_url)}"
        onerror="this.src='${fallback}'"
      >

      <div class="itemmain">

        <b>${esc(p.name)}</b>

        <span>
          ${esc(p.category || 'General')}
          ·
          ${esc(p.location || 'No location')}
        </span>

      </div>

      <strong>
        ${Number(p.quantity || 0)} pcs
      </strong>

      <span
        class="badge ${Number(p.quantity || 0) <= 7 ? 'low' : ''}"
      >
        ${
          Number(p.quantity || 0) <= 7
            ? 'Low'
            : 'In stock'
        }
      </span>

    </div>
  `;
}

function inventory() {
  const cats = [
    ...new Set(
      products
        .map(p => p.category)
        .filter(Boolean)
    )
  ].sort();

  const locs = [
    ...new Set(
      products
        .map(p => p.location)
        .filter(Boolean)
    )
  ].sort();

  view.innerHTML = `
    <section class="hero compact">

      <span class="eyebrow">
        PUBLIC INVENTORY
      </span>

      <h1>
        What we<br>
        <em>have.</em>
      </h1>

      <p>
        Browse current warehouse stock.
        Search by product, category or location.
      </p>

    </section>

    <section class="panel glass inventory-panel">

      <div class="head wrap">

        <div>

          <small class="section-label">
            CATALOG
          </small>

          <h2>
            All items
            <span class="muted">
              ${products.length} products
            </span>
          </h2>

        </div>

        <div class="filters">

          <input
            id="filter"
            class="search"
            placeholder="Search inventory…"
          >

          <select id="catFilter">
            <option value="">
              All categories
            </option>

            ${cats
              .map(
                x => `
                  <option value="${esc(x)}">
                    ${esc(x)}
                  </option>
                `
              )
              .join('')}

          </select>

          <select id="locFilter">
            <option value="">
              All locations
            </option>

            ${locs
              .map(
                x => `
                  <option value="${esc(x)}">
                    ${esc(x)}
                  </option>
                `
              )
              .join('')}

          </select>

        </div>

      </div>

      <div id="cards" class="cards">
        ${cards(products)}
      </div>

    </section>
  `;

  const apply = () => {
    const q =
      $('filter').value.toLowerCase();

    const c =
      $('catFilter').value;

    const l =
      $('locFilter').value;

    $('cards').innerHTML = cards(
      products.filter(p =>
        (
          `${p.name} ${p.description} ${p.category} ${p.location}`
        )
          .toLowerCase()
          .includes(q) &&
        (!c || p.category === c) &&
        (!l || p.location === l)
      )
    );
  };

  $('filter').oninput = apply;
  $('catFilter').onchange = apply;
  $('locFilter').onchange = apply;
}

function cards(arr) {
  return (
    arr
      .map(
        p => `
          <article class="product glass">

            <div class="imgwrap">

              <img
                loading="lazy"
                src="${safeImg(p.image_url)}"
                onerror="this.src='${fallback}'"
              >

              <span
                class="stock-dot ${
                  Number(p.quantity || 0) <= 7
                    ? 'warn'
                    : ''
                }"
              ></span>

              <span class="image-label">
                ${esc(p.category || 'General')}
              </span>

            </div>

            <div class="body">

              <div class="product-meta">

                <span>
                  ${esc(p.location || 'No location')}
                </span>

                <span>
                  ${Number(p.quantity || 0)} pcs
                </span>

              </div>

              <h3>
                ${esc(p.name)}
              </h3>

              <p>
                ${esc(
                  p.description ||
                  'No description provided.'
                )}
              </p>

              <div class="foot">

                <b>
                  ${
                    Number(p.price || 0) > 0
                      ? Number(p.price).toFixed(2) + ' OMR'
                      : 'Price on request'
                  }
                </b>

                <span
                  class="badge ${
                    Number(p.quantity || 0) <= 7
                      ? 'low'
                      : ''
                  }"
                >
                  ${
                    Number(p.quantity || 0) <= 7
                      ? 'Low stock'
                      : 'Available'
                  }
                </span>

              </div>

              ${
                isAdmin
                  ? `
                    <div class="actions">

                      <button
                        class="smallbtn"
                        onclick="editProduct('${p.id}')"
                      >
                        Edit
                      </button>

                      <button
                        class="smallbtn danger"
                        onclick="deleteProduct('${p.id}')"
                      >
                        Delete
                      </button>

                    </div>
                  `
                  : ''
              }

            </div>

          </article>
        `
      )
      .join('') ||
    empty(
      'No products found',
      'Try another search or filter.'
    )
  );
}

function activity() {
  view.innerHTML = `
    <section class="hero compact">

      <span class="eyebrow">
        AUDIT TRAIL
      </span>

      <h1>
        Warehouse<br>
        <em>history.</em>
      </h1>

      <p>
        Every product change is recorded automatically
        by Supabase.
      </p>

    </section>

    <section class="panel glass">

      <div class="head">

        <div>

          <small class="section-label">
            RECENT EVENTS
          </small>

          <h2>
            Activity
          </h2>

        </div>

        <span class="pill">
          ${activities.length} events
        </span>

      </div>

      <div class="timeline">

        ${
          activities
            .map(
              a => `
                <div class="timeline-row">

                  <div class="timeline-icon">
                    ${
                      a.action === 'created'
                        ? '+'
                        : a.action === 'deleted'
                          ? '×'
                          : '↻'
                    }
                  </div>

                  <div>

                    <b>
                      ${esc(a.product_name)}
                    </b>

                    <p>
                      ${esc(a.action)}
                      ${
                        a.actor_email
                          ? ` · ${esc(a.actor_email)}`
                          : ''
                      }
                    </p>

                  </div>

                  <time>
                    ${timeAgo(a.created_at)}
                  </time>

                </div>
              `
            )
            .join('') ||
          empty(
            'No activity yet',
            'Changes will appear here automatically.'
          )
        }

      </div>

    </section>
  `;
}

/* =========================
   ADMIN CONTROL CENTER
========================= */

function admin() {
  if (!isAdmin) {
    view.innerHTML = `
      <section class="hero">

        <span class="eyebrow">
          PRIVATE AREA
        </span>

        <h1>
          Admin<br>
          <em>access.</em>
        </h1>

        <p>
          Visitors can browse everything.
          Only the approved administrator can
          manage products, images and stock.
        </p>

        <div class="hero-actions">

          <button
            class="primary"
            onclick="loginDialog.showModal()"
          >
            🔐 Sign in as Admin
            <span>→</span>
          </button>

          <button
            class="ghost"
            onclick="go('inventory')"
          >
            View inventory
          </button>

        </div>

      </section>
    `;

    return;
  }

  const totalUnits = products.reduce(
    (n, p) => n + Number(p.quantity || 0),
    0
  );

  const lowStock = products.filter(
    p => Number(p.quantity || 0) <= 7
  ).length;

  view.innerHTML = `
    <section class="hero compact">

      <span class="eyebrow">
        ADMIN CONTROL CENTER
      </span>

      <h1>
        Manage your<br>
        <em>warehouse.</em>
      </h1>

      <p>
        Welcome back, ${esc(user?.email || 'Admin')}.
        This is your private warehouse management area.
      </p>

      <div class="hero-actions">

        <button
          class="primary"
          onclick="openAdd()"
        >
          ＋ Add new product
          <span>→</span>
        </button>

        <button
          class="ghost"
          onclick="go('inventory')"
        >
          View public inventory
        </button>

      </div>

    </section>

    <section class="stats">

      <div class="stat glass">
        <small>Products</small>
        <b>${products.length}</b>
        <span>in catalog</span>
      </div>

      <div class="stat glass">
        <small>Total units</small>
        <b>${totalUnits.toLocaleString()}</b>
        <span>warehouse stock</span>
      </div>

      <div class="stat glass">
        <small>Low stock</small>
        <b>${lowStock}</b>
        <span>
          ${lowStock ? 'needs attention' : 'everything healthy'}
        </span>
      </div>

      <div class="stat glass">
        <small>Account</small>
        <b>✓</b>
        <span>Admin protected</span>
      </div>

    </section>

    <section class="panel glass">

      <div class="head wrap">

        <div>

          <small class="section-label">
            PRODUCT MANAGEMENT
          </small>

          <h2>
            Your products
            <span class="muted">
              ${products.length} items
            </span>
          </h2>

        </div>

        <button
          class="primary"
          onclick="openAdd()"
        >
          ＋ Add product
        </button>

      </div>

      ${
        products.length
          ? products
              .map(
                p => `
                  <div class="item admin-row">

                    <img
                      class="thumb"
                      src="${safeImg(p.image_url)}"
                      onerror="this.src='${fallback}'"
                    >

                    <div class="itemmain">

                      <b>
                        ${esc(p.name)}
                      </b>

                      <span>
                        ${Number(p.quantity || 0)} pcs
                        · ${esc(p.location || 'No location')}
                        · ${esc(p.category || 'General')}
                      </span>

                    </div>

                    <button
                      class="smallbtn"
                      onclick="editProduct('${p.id}')"
                    >
                      Edit
                    </button>

                    <button
                      class="smallbtn danger"
                      onclick="deleteProduct('${p.id}')"
                    >
                      Delete
                    </button>

                  </div>
                `
              )
              .join('')
          : empty(
              'No products yet',
              'Click “Add product” above to create your first item.'
            )
      }

    </section>
  `;
}

function empty(title, sub) {
  return `
    <div class="empty">
      <strong>
        ${esc(title)}
      </strong>

      <span>
        ${esc(sub)}
      </span>
    </div>
  `;
}

function go(page) {
  currentPage = page;
  render();
}

function timeAgo(d) {
  if (!d) return '—';

  const s = Math.max(
    1,
    (Date.now() - new Date(d).getTime()) / 1000
  );

  if (s < 60) {
    return `${Math.round(s)}s ago`;
  }

  if (s < 3600) {
    return `${Math.round(s / 60)}m ago`;
  }

  if (s < 86400) {
    return `${Math.round(s / 3600)}h ago`;
  }

  return new Date(d).toLocaleDateString();
}

/* =========================
   ADD PRODUCT
========================= */

function openAdd() {
  if (!isAdmin) {
    loginDialog.showModal();
    return;
  }

  $('productForm').reset();

  $('productId').value = '';

  $('formTitle').textContent =
    'Add new product';

  $('formMsg').textContent = '';

  $('imagePreview').classList.add('hidden');

  productDialog.showModal();
}

/* =========================
   EDIT PRODUCT
========================= */

function editProduct(id) {
  const p = products.find(x => x.id === id);

  if (!p || !isAdmin) {
    return;
  }

  $('productId').value = p.id;

  $('pName').value = p.name || '';

  $('pDesc').value =
    p.description || '';

  $('pQty').value =
    Number(p.quantity || 0);

  $('pLoc').value =
    p.location || '';

  $('pCat').value =
    p.category || 'General';

  $('pPrice').value =
    Number(p.price || 0);

  $('pImage').value =
    p.image_url || '';

  $('pImageFile').value = '';

  $('formTitle').textContent =
    'Edit product';

  $('formMsg').textContent = '';

  preview(p.image_url);

  productDialog.showModal();
}

/* =========================
   IMAGE PREVIEW
========================= */

function preview(url) {
  const el = $('imagePreview');

  if (!url) {
    el.classList.add('hidden');
    return;
  }

  el.innerHTML = `
    <img
      src="${safeImg(url)}"
      onerror="this.src='${fallback}'"
    >

    <span>
      Image preview
    </span>
  `;

  el.classList.remove('hidden');
}

/* =========================
   UPLOAD IMAGE
========================= */

async function uploadImage(file) {
  if (!file) {
    return '';
  }

  if (
    !/^image\/(png|jpeg|webp|gif)$/.test(
      file.type
    )
  ) {
    throw Error(
      'Choose PNG, JPG, WEBP or GIF.'
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    throw Error(
      'Image is larger than 5 MB.'
    );
  }

  const ext =
    (
      file.name.split('.').pop() ||
      'jpg'
    ).toLowerCase();

  const path =
    `${user.id}/${crypto.randomUUID()}.${ext}`;

  const up = await sb
    .storage
    .from(C.STORAGE_BUCKET)
    .upload(
      path,
      file,
      {
        upsert: false,
        contentType: file.type
      }
    );

  if (up.error) {
    throw up.error;
  }

  return sb
    .storage
    .from(C.STORAGE_BUCKET)
    .getPublicUrl(path)
    .data
    .publicUrl;
}

/* =========================
   DELETE PRODUCT
========================= */

async function deleteProduct(id) {
  if (!isAdmin) {
    return;
  }

  if (
    !confirm(
      'Delete this product? This action will be recorded in activity.'
    )
  ) {
    return;
  }

  const r = await sb
    .from('products')
    .delete()
    .eq('id', id);

  if (r.error) {
    toast(
      r.error.message,
      'error'
    );

    return;
  }

  toast('Product deleted');

  await loadAll();

  render();
}

/* =========================
   SAVE PRODUCT
========================= */

if ($('productForm')) {
  $('productForm').onsubmit = async e => {
    e.preventDefault();

    if (!isAdmin) {
      return;
    }

    const btn =
      $('saveProduct');

    busy(
      btn,
      true
    );

    $('formMsg').textContent = '';

    try {
      let image =
        $('pImage').value.trim();

      const file =
        $('pImageFile').files[0];

      if (file) {
        image =
          await uploadImage(file);
      }

      const payload = {
        name:
          $('pName').value.trim(),

        description:
          $('pDesc').value.trim(),

        quantity:
          Math.max(
            0,
            Number($('pQty').value) || 0
          ),

        location:
          $('pLoc').value.trim(),

        category:
          $('pCat').value.trim() ||
          'General',

        price:
          Math.max(
            0,
            Number($('pPrice').value) || 0
          ),

        image_url:
          image
      };

      if (!payload.name) {
        throw Error(
          'Product name is required.'
        );
      }

      if (!payload.location) {
        throw Error(
          'Product location is required.'
        );
      }

      const id =
        $('productId').value;

      let r;

      if (id) {
        r = await sb
          .from('products')
          .update(payload)
          .eq('id', id);
      } else {
        r = await sb
          .from('products')
          .insert(payload);
      }

      if (r.error) {
        throw r.error;
      }

      productDialog.close();

      toast(
        id
          ? 'Product updated successfully'
          : 'Product added successfully'
      );

      await loadAll();

      render();

    } catch (err) {
      $('formMsg').textContent =
        err.message || String(err);

      toast(
        err.message || 'Something went wrong',
        'error'
      );
    } finally {
      busy(
        btn,
        false
      );
    }
  };
}

/* =========================
   LOGIN
========================= */

if ($('loginForm')) {
  $('loginForm').onsubmit = async e => {
    e.preventDefault();

    if (!sb) {
      return;
    }

    const btn =
      $('loginSubmit');

    busy(
      btn,
      true,
      'Signing in…'
    );

    $('loginMsg').textContent = '';

    const r =
      await sb.auth.signInWithPassword({
        email:
          $('email').value.trim(),

        password:
          $('password').value
      });

    if (r.error) {
      $('loginMsg').textContent =
        r.error.message;

      busy(
        btn,
        false
      );

      return;
    }

    loginDialog.close();

    toast(
      'Signed in successfully'
    );

    busy(
      btn,
      false
    );
  };
}

/* =========================
   LOGOUT
========================= */

if ($('logout')) {
  $('logout').onclick =
    async () => {
      if (!sb) {
        return;
      }

      await sb.auth.signOut();

      toast(
        'Signed out'
      );

      go('dashboard');
    };
}

/* =========================
   NAVIGATION
========================= */

document
  .querySelectorAll(
    '.sidebar nav button'
  )
  .forEach(b => {
    b.onclick = () =>
      go(b.dataset.page);
  });

$('brand')?.addEventListener(
  'click',
  () => go('dashboard')
);

document
  .querySelector('.brand')
  ?.addEventListener(
    'click',
    () => go('dashboard')
  );

if ($('adminQuick')) {
  $('adminQuick').onclick =
    () => go('admin');
}

if ($('searchBtn')) {
  $('searchBtn').onclick =
    () => {
      go('inventory');

      setTimeout(
        () => $('filter')?.focus(),
        80
      );
    };
}

/* =========================
   IMAGE FILE INPUT
========================= */

if ($('pImageFile')) {
  $('pImageFile').onchange =
    e => {
      const f =
        e.target.files[0];

      if (f) {
        preview(
          URL.createObjectURL(f)
        );
      }
    };
}

/* =========================
   START
========================= */

boot();
