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
let profiles = [];
let serials = [];
let user = null;
let isAdmin = false;
let profile = null;
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


/* =========================
   UI HELPERS
========================= */

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
  const dot = $('liveDot');
  const text = $('statusText');

  if (dot) dot.classList.toggle('offline', !ok);
  if (text) text.textContent = ok ? 'Live' : 'Connecting';
}


/* =========================
   BOOT
========================= */

async function boot() {
  if (!sb) {
    renderSetup();
    return;
  }

  try {
    const r = await sb.auth.getSession();

    user = r.data?.session?.user || null;

    await refreshAuth();

    setConnection(true);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Connection failed', 'error');
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user || null;

    await refreshAuth();

    updateAuth();

    render();
  });

  subscribeRealtime();

  await loadAll();

  render();
}


/* =========================
   AUTH / ADMIN
========================= */

async function refreshAuth() {
  isAdmin = false;
  profile = null;
  if (!user || !sb) { updateAuth(); return; }
  const [adminRow, profileRow] = await Promise.all([
    sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle(),
    sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle()
  ]);
  isAdmin = !adminRow.error && !!adminRow.data;
  profile = profileRow.data || null;
  if (profile?.role === 'admin') isAdmin = true;
  updateAuth();
}

function updateAuth() {
  const hello = $('hello');
  const avatar = $('avatar');
  const logout = $('logout');

  if (hello) {
    hello.textContent = user
      ? (isAdmin
          ? `Admin · ${user.email}`
          : profile?.role === 'delivery'
            ? `Delivery · ${profile.full_name || user.email}`
            : `Signed in · ${user.email}`)
      : 'Public inventory';
  }

  if (avatar) {
    avatar.textContent =
      (user?.email || 'W').slice(0, 1).toUpperCase();
  }

  if (logout) {
    logout.classList.toggle('hidden', !user);
  }
}


/* =========================
   LOAD DATA
   IMPORTANT:
   No created_at dependency
========================= */

async function loadAll() {
  if (!sb) return;

  const [p, a] = await Promise.all([
    sb.from('products').select('*'),
    sb.from('activity').select('*')
  ]);

  if (isAdmin) {
    const [pr, sr] = await Promise.all([
      sb.from('profiles').select('*').eq('role', 'delivery').order('created_at', { ascending: false }),
      sb.from('product_serials').select('*, products(name)').order('created_at', { ascending: false })
    ]);
    profiles = pr.error ? [] : (pr.data || []);
    serials = sr.error ? [] : (sr.data || []);
  } else {
    profiles = [];
    serials = [];
  }

  if (p.error) {
    console.error('Products error:', p.error);
    toast(p.error.message, 'error');
  } else {
    products = p.data || [];
  }

  if (a.error) {
    console.warn('Activity error:', a.error);
  } else {
    activities = a.data || [];

    activities.sort((x, y) => {
      const dx = getDateValue(x);
      const dy = getDateValue(y);

      return dy - dx;
    });

    activities = activities.slice(0, 60);
  }
}


/* =========================
   FLEXIBLE DATE HANDLER
========================= */

function getDateValue(obj) {
  if (!obj) return 0;

  const value =
    obj.created_at ||
    obj.createdAt ||
    obj.timestamp ||
    obj.inserted_at ||
    obj.updated_at ||
    obj.updatedAt;

  if (!value) return 0;

  const d = new Date(value).getTime();

  return Number.isNaN(d) ? 0 : d;
}


/* =========================
   REALTIME
========================= */

function subscribeRealtime() {
  if (!sb) return;

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
          .select('*');

        if (!a.error) {
          activities = a.data || [];

          activities.sort((x, y) => {
            return getDateValue(y) - getDateValue(x);
          });

          activities = activities.slice(0, 60);
        }

        if (currentPage === 'activity') {
          render();
        }
      }
    )

    .subscribe(status => {
      setConnection(status === 'SUBSCRIBED');
    });
}


/* =========================
   SETUP
========================= */

function renderSetup() {
  view.innerHTML = `
    <section class="hero setup">

      <span class="eyebrow">ONE-TIME CONNECTION</span>

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


/* =========================
   ROUTING
========================= */

function render() {
  document.querySelectorAll('.sidebar nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.page === currentPage);
    if (b.classList.contains('admin-only')) b.classList.toggle('hidden', !isAdmin);
  });
  if (!isAdmin && (currentPage === 'users' || currentPage === 'serials')) currentPage = 'dashboard';
  if (currentPage === 'dashboard') dashboard();
  else if (currentPage === 'inventory') inventory();
  else if (currentPage === 'activity') activity();
  else if (currentPage === 'admin') admin();
  else if (currentPage === 'users') adminUsers();
  else if (currentPage === 'serials') serialManager();
}

/* =========================
   DASHBOARD
========================= */

function dashboard() {
  const total = products.reduce(
    (n, p) => n + Number(p.quantity || 0),
    0
  );

  const low = products.filter(
    p => Number(p.quantity || 0) <= 7
  ).length;

  const cats = new Set(
    products
      .map(p => p.category)
      .filter(Boolean)
  ).size;

  const locs = new Set(
    products
      .map(p => p.location)
      .filter(Boolean)
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
          onclick="go('inventory')">
          Browse inventory <span>→</span>
        </button>

        ${
          isAdmin
            ? `
              <button
                class="ghost"
                onclick="go('admin')">
                Open control center
              </button>
            `
            : `
              <button
                class="ghost"
                onclick="loginDialog.showModal()">
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

            <h2>Recently added</h2>
          </div>

          <button
            class="textbtn"
            onclick="go('inventory')">
            View all →
          </button>

        </div>

        ${
          products.slice(0, 6).map(itemRow).join('')
          ||
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

            <h2>Needs attention</h2>
          </div>

          <span class="pill">
            ${low ? low + ' low' : 'All good'}
          </span>

        </div>

        <div class="health">

          ${
            products
              .filter(
                p => Number(p.quantity || 0) <= 7
              )
              .slice(0, 6)
              .map(
                p => `
                  <div class="health-row">

                    <span class="health-dot"></span>

                    <div>
                      <b>${esc(p.name)}</b>

                      <small>
                        ${Number(p.quantity || 0)}
                        units ·
                        ${esc(p.location)}
                      </small>
                    </div>

                  </div>
                `
              )
              .join('')
            ||
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


/* =========================
   ITEM ROW
========================= */

function itemRow(p) {
  return `
    <div class="item">

      <img
        class="thumb"
        src="${safeImg(p.image_url)}"
        onerror="this.src='${fallback}'">

      <div class="itemmain">

        <b>${esc(p.name)}</b>

        <span>
          ${esc(p.category)} ·
          ${esc(p.location)}
        </span>

      </div>

      <strong>
        ${Number(p.quantity || 0)} pcs
      </strong>

      <span
        class="badge ${
          Number(p.quantity || 0) <= 7
            ? 'low'
            : ''
        }">

        ${
          Number(p.quantity || 0) <= 7
            ? 'Low'
            : 'In stock'
        }

      </span>

    </div>
  `;
}


/* =========================
   INVENTORY
========================= */

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
            placeholder="Search inventory…">

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
      ($('filter')?.value || '')
        .toLowerCase();

    const c =
      $('catFilter')?.value || '';

    const l =
      $('locFilter')?.value || '';

    const filtered = products.filter(p => {

      const text = `
        ${p.name || ''}
        ${p.description || ''}
        ${p.category || ''}
        ${p.location || ''}
      `.toLowerCase();

      return (
        text.includes(q) &&
        (!c || p.category === c) &&
        (!l || p.location === l)
      );
    });

    $('cards').innerHTML = cards(filtered);
  };

  $('filter').oninput = apply;
  $('catFilter').onchange = apply;
  $('locFilter').onchange = apply;
}


/* =========================
   PRODUCT CARDS
========================= */

function cards(arr) {
  return (
    arr
      .map(p => `
        <article class="product glass">

          <div class="imgwrap">

            <img
              loading="lazy"
              src="${safeImg(p.image_url)}"
              onerror="this.src='${fallback}'">

            <span
              class="stock-dot ${
                Number(p.quantity || 0) <= 7
                  ? 'warn'
                  : ''
              }">
            </span>

            <span class="image-label">
              ${esc(p.category || 'General')}
            </span>

          </div>


          <div class="body">

            <div class="product-meta">

              <span>
                ${esc(p.location)}
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
                }">

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
                      type="button"
                      class="smallbtn edit-btn"
                      title="Edit ${esc(p.name)}"
                      aria-label="Edit ${esc(p.name)}"
                      onclick="editProduct('${p.id}')">
                      <span class="btn-icon">✎</span>
                      <span>Edit item</span>
                    </button>

                    <button
                      type="button"
                      class="smallbtn danger delete-btn"
                      title="Delete ${esc(p.name)}"
                      aria-label="Delete ${esc(p.name)}"
                      onclick="deleteProduct('${p.id}')">
                      <span class="btn-icon">×</span>
                      <span>Delete item</span>
                    </button>

                  </div>
                `
                : ''
            }

          </div>

        </article>
      `)
      .join('')
    ||
    empty(
      'No products found',
      'Try another search or filter.'
    )
  );
}


/* =========================
   ACTIVITY
========================= */

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
        Every product change is recorded automatically by Supabase.
      </p>

    </section>


    <section class="panel glass">

      <div class="head">

        <div>

          <small class="section-label">
            RECENT EVENTS
          </small>

          <h2>Activity</h2>

        </div>

        <span class="pill">
          ${activities.length} events
        </span>

      </div>


      <div class="timeline">

        ${
          activities
            .map(a => {

              const icon =
                a.action === 'created'
                  ? '+'
                  : a.action === 'deleted'
                    ? '×'
                    : '↻';

              const actor =
                a.actor_email
                  ? ` · ${esc(a.actor_email)}`
                  : '';

              const date =
                getDateValue(a);

              return `
                <div class="timeline-row">

                  <div class="timeline-icon">
                    ${icon}
                  </div>

                  <div>

                    <b>
                      ${esc(
                        a.product_name ||
                        a.name ||
                        'Product'
                      )}
                    </b>

                    <p>
                      ${esc(a.action || 'updated')}
                      ${actor}
                    </p>

                  </div>

                  <time>
                    ${
                      date
                        ? timeAgo(date)
                        : '—'
                    }
                  </time>

                </div>
              `;
            })
            .join('')
          ||
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
   ADMIN
========================= */

function admin() {

  if (!isAdmin) {

    if (user) {

      view.innerHTML = `
        <section class="hero">

          <span class="eyebrow">
            PRIVATE AREA
          </span>

          <h1>
            Not<br>
            <em>authorized.</em>
          </h1>

          <p>
            You're signed in as
            <b>${esc(user.email)}</b>,
            but this account isn't authorized as an administrator.
          </p>

          <button
            class="ghost"
            onclick="document.getElementById('logout').click()">
            Sign out
          </button>

        </section>
      `;

      return;
    }


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
          Only an approved administrator can manage
          products, images and stock.
        </p>

        <button
          class="primary"
          onclick="loginDialog.showModal()">

          Sign in <span>→</span>

        </button>

      </section>
    `;

    return;
  }


  view.innerHTML = `
    <section class="hero compact">

      <span class="eyebrow">
        ADMIN · ${esc(user.email)}
      </span>

      <h1>
        Control the<br>
        <em>warehouse.</em>
      </h1>

      <p>
        Add products, change quantities, upload images
        and remove old stock.
        RLS protects the database.
      </p>

      <button
        class="primary"
        onclick="openAdd()">
        ＋ Add item
      </button>

    </section>


    <section class="panel glass">

      <div class="head">

        <div>

          <small class="section-label">
            MANAGEMENT
          </small>

          <h2>Inventory</h2>

        </div>

        <span class="pill">
          ${products.length} items
        </span>

      </div>


      ${
        products
          .map(p => `
            <div class="item admin-row">

              <img
                class="thumb"
                src="${safeImg(p.image_url)}"
                onerror="this.src='${fallback}'">

              <div class="itemmain">

                <b>
                  ${esc(p.name)}
                </b>

                <span>
                  ${Number(p.quantity || 0)} pcs ·
                  ${esc(p.location)} ·
                  ${esc(p.category)}
                </span>

              </div>


              <button
                type="button"
                class="smallbtn edit-btn"
                title="Edit ${esc(p.name)}"
                aria-label="Edit ${esc(p.name)}"
                onclick="editProduct('${p.id}')">

                <span class="btn-icon">✎</span>
                <span>Edit item</span>

              </button>


              <button
                type="button"
                class="smallbtn danger delete-btn"
                title="Delete ${esc(p.name)}"
                aria-label="Delete ${esc(p.name)}"
                onclick="deleteProduct('${p.id}')">

                <span class="btn-icon">×</span>
                <span>Delete item</span>

              </button>

            </div>
          `)
          .join('')
        ||
        empty(
          'No items yet',
          'Add your first item above.'
        )
      }

    </section>
  `;
}


/* =========================
   EMPTY
========================= */

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


/* =========================
   NAVIGATION
========================= */

function go(page) {
  currentPage = page;
  render();
}


/* =========================
   TIME
========================= */

function timeAgo(dateValue) {

  if (!dateValue) return '—';

  const timestamp =
    typeof dateValue === 'number'
      ? dateValue
      : new Date(dateValue).getTime();

  if (!timestamp) return '—';

  const s = Math.max(
    1,
    (Date.now() - timestamp) / 1000
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

  return new Date(timestamp).toLocaleDateString();
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
    'Add item';

  $('formMsg').textContent = '';

  $('imagePreview').classList.add('hidden');

  productDialog.showModal();
}


/* =========================
   EDIT PRODUCT
========================= */

function editProduct(id) {

  const p =
    products.find(x => x.id === id);

  if (!p || !isAdmin) return;

  $('productId').value =
    p.id;

  $('pName').value =
    p.name || '';

  $('pDesc').value =
    p.description || '';

  $('pQty').value =
    p.quantity ?? 0;

  $('pLoc').value =
    p.location || '';

  $('pCat').value =
    p.category || 'General';

  $('pPrice').value =
    p.price ?? 0;

  $('pImage').value =
    p.image_url || '';

  $('pImageFile').value = '';

  $('formTitle').textContent =
    'Edit item';

  $('formMsg').textContent =
    '';

  preview(p.image_url);

  productDialog.showModal();
}


/* =========================
   IMAGE PREVIEW
========================= */

function preview(url) {

  const el =
    $('imagePreview');

  if (!url) {
    el.classList.add('hidden');
    return;
  }

  el.innerHTML = `
    <img
      src="${safeImg(url)}"
      onerror="this.src='${fallback}'">

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

  if (!file) return '';

  if (
    !/^image\/(png|jpeg|webp|gif)$/.test(
      file.type
    )
  ) {
    throw Error(
      'Choose PNG, JPG, WEBP or GIF.'
    );
  }

  if (
    file.size > 5 * 1024 * 1024
  ) {
    throw Error(
      'Image is larger than 5 MB.'
    );
  }

  const ext =
    (
      file.name
        .split('.')
        .pop() || 'jpg'
    ).toLowerCase();

  const path =
    `${user.id}/${crypto.randomUUID()}.${ext}`;

  const up =
    await sb
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

  if (
    !isAdmin ||
    !confirm(
      'Delete this item? This will be recorded in activity.'
    )
  ) {
    return;
  }

  const r =
    await sb
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

  toast('Item deleted');

  await loadAll();

  render();
}


/* =========================
   SAVE PRODUCT
========================= */

$('productForm').onsubmit = async e => {

  e.preventDefault();

  if (!isAdmin) return;

  const btn =
    $('saveProduct');

  busy(btn, true);

  $('formMsg').textContent = '';

  try {

    let image =
      $('pImage').value.trim();

    const file =
      $('pImageFile')
        .files[0];

    if (file) {
      image =
        await uploadImage(file);
    }

    const payload = {

      name:
        $('pName')
          .value
          .trim(),

      description:
        $('pDesc')
          .value
          .trim(),

      quantity:
        Math.max(
          0,
          Number(
            $('pQty').value
          ) || 0
        ),

      location:
        $('pLoc')
          .value
          .trim(),

      category:
        $('pCat')
          .value
          .trim() ||
        'General',

      price:
        Math.max(
          0,
          Number(
            $('pPrice').value
          ) || 0
        ),

      image_url:
        image
    };


    const id =
      $('productId').value;


    let r;

    if (id) {

      r =
        await sb
          .from('products')
          .update(payload)
          .eq('id', id);

    } else {

      r =
        await sb
          .from('products')
          .insert(payload);

    }


    if (r.error) {
      throw r.error;
    }


    productDialog.close();

    toast(
      id
        ? 'Item updated'
        : 'Item added'
    );

    await loadAll();

    render();

  } catch (err) {

    console.error(err);

    $('formMsg').textContent =
      err.message ||
      String(err);

  } finally {

    busy(btn, false);
  }
};


/* =========================
   LOGIN
========================= */

$('loginForm').onsubmit =
  async e => {

    e.preventDefault();

    if (!sb) return;

    const btn =
      $('loginSubmit');

    busy(
      btn,
      true,
      'Signing in…'
    );

    $('loginMsg').textContent =
      '';

    const r =
      await sb.auth.signInWithPassword({
        email:
          $('email')
            .value
            .trim(),

        password:
          $('password')
            .value
      });


    if (r.error) {

      $('loginMsg').textContent =
        r.error.message;

      busy(btn, false);

      return;
    }


    loginDialog.close();

    toast('Signed in');

    busy(btn, false);
  };


/* =========================
   LOGOUT
========================= */

$('logout').onclick =
  async () => {

    if (!sb) return;

    await sb.auth.signOut();

    toast('Signed out');

    go('dashboard');
  };


/* =========================
   NAV BUTTONS
========================= */

document
  .querySelectorAll(
    '.sidebar nav button'
  )
  .forEach(b => {

    b.onclick = () =>
      go(b.dataset.page);

  });


/* =========================
   BRAND
========================= */

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


/* =========================
   QUICK ADMIN
========================= */

$('adminQuick')?.addEventListener(
  'click',
  () => go('admin')
);


/* =========================
   SEARCH BUTTON
========================= */

$('searchBtn')?.addEventListener(
  'click',
  () => {

    go('inventory');

    setTimeout(
      () => $('filter')?.focus(),
      80
    );

  }
);


/* =========================
   IMAGE FILE INPUT
========================= */

$('pImageFile')?.addEventListener(
  'change',
  e => {

    const f =
      e.target.files[0];

    if (f) {
      preview(
        URL.createObjectURL(f)
      );
    }

  }
);


/* =========================
   ADMIN USER MANAGEMENT
========================= */

function adminUsers() {
  if (!isAdmin) return admin();
  view.innerHTML = `
    <section class="hero compact">
      <span class="eyebrow">ADMIN · TEAM</span>
      <h1>Delivery<br><em>accounts.</em></h1>
      <p>Create and manage delivery accounts. Each account is linked to <b>profiles.role = delivery</b>.</p>
      <div class="hero-actions"><button class="primary" onclick="deliveryUserDialog.showModal()">＋ Add delivery guy</button><button class="ghost" onclick="go('serials')">Manage serials →</button></div>
    </section>
    <section class="panel glass">
      <div class="head"><div><small class="section-label">DELIVERY TEAM</small><h2>Delivery guys</h2></div><span class="pill">${profiles.length} accounts</span></div>
      ${profiles.map(p => `
        <div class="item admin-row"><div class="avatar small-avatar">${esc((p.full_name || p.email || 'D').slice(0,1).toUpperCase())}</div><div class="itemmain"><b>${esc(p.full_name || 'Unnamed')}</b><span>${esc(p.email || '—')} · <span class="status-pill">${p.active === false ? 'DISABLED' : 'DELIVERY'}</span></span></div>${p.active === false ? '' : `<button class="smallbtn danger" onclick="disableDeliveryUser('${p.user_id}')">Disable</button>`}</div>`).join('') || empty('No delivery accounts yet','Create your first delivery guy above.')}
    </section>`;
}

async function createDeliveryUser(e) {
  e?.preventDefault();
  if (!isAdmin) return;
  const btn = $('createDeliveryUserBtn'), msg = $('deliveryUserMsg');
  const full_name = $('duName')?.value.trim(), email = $('duEmail')?.value.trim().toLowerCase(), password = $('duPassword')?.value;
  if (!full_name || !email || !password) return;
  if (password.length < 8) { msg.textContent = 'Password must be at least 8 characters.'; return; }
  busy(btn, true, 'Creating…'); msg.textContent = '';
  try {
    const { data, error } = await sb.functions.invoke('create-delivery-user', { body: { full_name, email, password } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Could not create account.');
    deliveryUserDialog.close(); $('deliveryUserForm')?.reset(); toast('Delivery account created.', 'success'); await loadAll(); render();
  } catch (err) { console.error(err); msg.textContent = err.message || 'Could not create account.'; }
  finally { busy(btn, false); }
}

async function disableDeliveryUser(id) {
  if (!isAdmin || !id) return;
  if (!confirm('Disable this delivery account?')) return;
  const { error } = await sb.from('profiles').update({ active: false }).eq('user_id', id).eq('role', 'delivery');
  if (error) return toast(error.message, 'error');
  toast('Delivery account disabled.', 'success'); await loadAll(); render();
}

/* =========================
   SERIAL NUMBER MANAGER
========================= */

function serialManager() {
  if (!isAdmin) return admin();
  const available = serials.filter(s => s.status === 'available').length;
  view.innerHTML = `
    <section class="hero compact"><span class="eyebrow">ADMIN · PHYSICAL STOCK</span><h1>Serial<br><em>manager.</em></h1><p>Add the real serial number for every physical unit. Delivery requests will later lock onto one exact serial.</p><div class="hero-actions"><button class="primary" onclick="openSerialDialog()">＋ Add serial</button></div></section>
    <section class="stats"><div class="stat glass"><small>Total serials</small><b>${serials.length}</b><span>physical units</span></div><div class="stat glass"><small>Available</small><b>${available}</b><span>ready for delivery</span></div><div class="stat glass"><small>Reserved / used</small><b>${serials.length - available}</b><span>not currently available</span></div></section>
    <section class="panel glass"><div class="head"><div><small class="section-label">SERIAL INVENTORY</small><h2>Physical units</h2></div><span class="pill">${serials.length}</span></div>
      ${serials.map(s => `<div class="item admin-row"><div class="serial-icon">№</div><div class="itemmain"><b>${esc(s.serial_number)}</b><span>${esc(s.products?.name || 'Unknown product')} · ${esc(s.status || 'available')}</span></div>${s.status === 'available' ? `<button class="smallbtn danger" onclick="deleteSerial('${s.id}')">Delete</button>` : `<span class="pill">${esc(s.status)}</span>`}</div>`).join('') || empty('No serials yet','Add serial numbers for your physical units.')}
    </section>`;
}

function openSerialDialog() {
  if (!isAdmin) return;
  const select = $('serialProduct');
  select.innerHTML = products.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${Number(p.quantity || 0)} pcs</option>`).join('');
  $('serialNumber').value = ''; $('serialMsg').textContent = ''; serialDialog.showModal();
}

async function saveSerial(e) {
  e?.preventDefault(); if (!isAdmin) return;
  const btn = $('saveSerialBtn'), msg = $('serialMsg');
  const product_id = $('serialProduct')?.value, serial_number = $('serialNumber')?.value.trim();
  if (!product_id || !serial_number) return;
  busy(btn, true, 'Saving…'); msg.textContent = '';
  const { error } = await sb.from('product_serials').insert({ product_id, serial_number, status: 'available' });
  if (error) { msg.textContent = error.message; busy(btn, false); return; }
  serialDialog.close(); $('serialForm')?.reset(); toast('Serial number added.', 'success'); await loadAll(); render(); busy(btn, false);
}

async function deleteSerial(id) {
  if (!isAdmin || !id) return; if (!confirm('Delete this serial number?')) return;
  const { error } = await sb.from('product_serials').delete().eq('id', id).eq('status', 'available');
  if (error) return toast(error.message, 'error'); toast('Serial deleted.', 'success'); await loadAll(); render();
}

$('deliveryUserForm')?.addEventListener('submit', createDeliveryUser);
$('serialForm')?.addEventListener('submit', saveSerial);

/* =========================
   START
========================= */

boot();
