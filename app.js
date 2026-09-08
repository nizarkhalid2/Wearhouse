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
let role = 'public';
let profile = null;
let units = [];
let deliveries = [];
let notifications = [];
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
  role = 'public';
  profile = null;

  if (!user || !sb) {
    updateAuth();
    return;
  }

  const [a, p] = await Promise.all([
    sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle(),
    sb.from('profiles').select('id,full_name,role').eq('id', user.id).maybeSingle()
  ]);

  if (!a.error && a.data) isAdmin = true;

  if (!p.error && p.data) {
    profile = p.data;
    role = p.data.role || (isAdmin ? 'admin' : 'public');
  } else if (isAdmin) {
    role = 'admin';
  }

  updateAuth();
}

function updateAuth() {
  const hello = $('hello');
  const avatar = $('avatar');
  const logout = $('logout');

  const displayName = profile?.full_name || user?.email || 'Warehouse';

  if (hello) {
    hello.textContent = user
      ? `${role === 'admin' ? 'Admin' : role === 'delivery_guy' ? 'Delivery ·' : 'Signed in ·'} ${displayName}`
      : 'Public inventory';
  }

  if (avatar) avatar.textContent = displayName.slice(0, 1).toUpperCase();
  if (logout) logout.classList.toggle('hidden', !user);

  const adminQuick = $('adminQuick');
  if (adminQuick) adminQuick.classList.toggle('hidden', !isAdmin);
}


/* =========================
   LOAD DATA
   IMPORTANT:
   No created_at dependency
========================= */

async function loadAll() {
  if (!sb) return;

  const queries = [
    sb.from('products').select('*'),
    sb.from('activity').select('*'),
    sb.from('inventory_units').select('*, products(name,category,location,image_url,price)').order('created_at',{ascending:false}),
    sb.from('delivery_requests').select('*, profiles:delivery_guy_id(full_name,email), inventory_units(serial_number), products:product_id(name,category,image_url)').order('created_at',{ascending:false}),
    user ? sb.from('notifications').select('*').eq('recipient_id', user.id).order('created_at',{ascending:false}).limit(30) : Promise.resolve({data:[],error:null})
  ];

  const [p,a,u,d,n] = await Promise.all(queries);

  if (p.error) toast(p.error.message,'error'); else products = p.data || [];
  if (!a.error) {
    activities = (a.data || []).sort((x,y)=>getDateValue(y)-getDateValue(x)).slice(0,60);
  }
  if (!u.error) units = u.data || [];
  if (!d.error) deliveries = d.data || [];
  if (!n.error) notifications = n.data || [];
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
      { event: '*', schema: 'public', table: 'delivery_requests' },
      async () => { await loadAll(); render(); if (user) toast('Delivery update received'); }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      async () => { await loadAll(); render(); if (currentPage !== 'deliveries') toast('New warehouse notification'); }
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
          <p>Admins manage stock; delivery accounts can manage only their delivery workflow.</p>
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
  const deliveryNav = document.querySelector('[data-page="deliveries"]');
  if (deliveryNav) deliveryNav.classList.toggle('hidden', !user || !['admin','delivery_guy'].includes(role));

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
  } else if (currentPage === 'deliveries') {
    deliveriesPage();
  }
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

        ${
          role === 'delivery_guy'
            ? `<button class="primary" onclick="go('deliveries')">Open delivery desk <span>→</span></button>`
            : ''
        }

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


              <button type="button" class="smallbtn edit-btn" onclick="manageSerials('${p.id}')"><span class="btn-icon">#</span><span>Serials</span></button>

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


    <section class="panel glass">
      <div class="head">
        <div><small class="section-label">DELIVERY CONTROL</small><h2>Delivery requests</h2></div>
        <span class="pill">${deliveries.filter(d=>d.status!=='completed' && d.status!=='rejected').length} active</span>
      </div>
      ${adminDeliveryCards()}
    </section>
  `;
}



function unitForDelivery(id) {
  return units.find(u => u.id === id);
}

function openDeliveryForProduct(productId) {
  if (role !== 'delivery_guy') {
    toast('Delivery access is for delivery accounts.', 'error');
    return;
  }
  const available = units.filter(u => u.product_id === productId && u.status === 'available');
  if (!available.length) {
    toast('No available serial-numbered unit for this product.', 'error');
    go('deliveries');
    return;
  }
  const p = products.find(x=>x.id===productId);
  $('deliveryUnitId').value = available[0].id;
  $('deliveryItemPreview').innerHTML = `<b>${esc(p?.name || 'Item')}</b><span>Serial: ${esc(available[0].serial_number)}</span>`;
  $('dDestination').value='';
  $('dRecipient').value='';
  $('dDate').value=new Date().toISOString().slice(0,10);
  $('dNotes').value='';
  $('deliveryMsg').textContent='';
  deliveryDialog.showModal();
}

function deliveryCard(d, adminMode=false) {
  const driver = d.profiles?.full_name || d.profiles?.email || d.delivery_guy_id || 'Delivery';
  const item = d.products?.name || 'Item';
  const serial = d.inventory_units?.serial_number || d.serial_number || '—';
  const statusLabel = ({
    pending_admin_approval:'Awaiting admin',
    approved_for_delivery:'Approved · in delivery',
    delivery_note_submitted:'Note submitted · review',
    completed:'Completed',
    rejected:'Rejected'
  })[d.status] || d.status;

  let action='';
  if (adminMode && d.status==='pending_admin_approval')
    action=`<button class="smallbtn" onclick="approveDelivery('${d.id}')">✓ Accept</button><button class="smallbtn danger" onclick="rejectDelivery('${d.id}')">× Reject</button>`;
  if (adminMode && d.status==='delivery_note_submitted')
    action=`<button class="smallbtn" onclick="completeDelivery('${d.id}')">✓ Accept delivery</button><button class="smallbtn danger" onclick="rejectDelivery('${d.id}',true)">× Reject</button>`;
  if (!adminMode && d.status==='approved_for_delivery')
    action=`<button class="smallbtn" onclick="openNote('${d.id}')">Upload delivery note</button>`;

  return `<article class="delivery-card glass">
    <div class="delivery-top"><div><span class="section-label">${esc(statusLabel)}</span><h3>${esc(item)}</h3></div><span class="delivery-status ${esc(d.status)}">${esc(statusLabel)}</span></div>
    <div class="delivery-grid">
      <div><small>Serial</small><b>${esc(serial)}</b></div>
      <div><small>Delivery guy</small><b>${esc(driver)}</b></div>
      <div><small>Destination</small><b>${esc(d.destination)}</b></div>
      <div><small>Date</small><b>${esc(d.delivery_date || '—')}</b></div>
      <div><small>Recipient</small><b>${esc(d.recipient || '—')}</b></div>
      <div><small>Created</small><b>${timeAgo(getDateValue(d))}</b></div>
    </div>
    ${d.delivery_note_url ? `<a class="note-link" href="${esc(d.delivery_note_url)}" target="_blank" rel="noopener">View delivery note ↗</a>` : ''}
    ${action ? `<div class="delivery-actions">${action}</div>` : ''}
  </article>`;
}

function adminDeliveryCards() {
  const active = deliveries.filter(d=>d.status!=='completed' && d.status!=='rejected');
  return active.map(d=>deliveryCard(d,true)).join('') || empty('No delivery requests','New requests will appear here in real time.');
}

function deliveriesPage() {
  if (!user || !['admin','delivery_guy'].includes(role)) {
    view.innerHTML = `<section class="hero"><span class="eyebrow">PRIVATE DELIVERY DESK</span><h1>Delivery<br><em>access.</em></h1><p>Sign in with a delivery or administrator account to use the warehouse delivery workflow.</p><button class="primary" onclick="loginDialog.showModal()">Sign in <span>→</span></button></section>`;
    return;
  }

  const mine = role === 'delivery_guy'
    ? deliveries.filter(d=>d.delivery_guy_id===user.id)
    : deliveries;

  const unread = notifications.filter(n=>!n.read_at).length;
  view.innerHTML = `
    <section class="hero compact">
      <span class="eyebrow">${role === 'admin' ? 'ADMIN · DELIVERY CONTROL' : 'DELIVERY · FIELD DESK'}</span>
      <h1>${role === 'admin' ? 'Delivery<br><em>control.</em>' : 'Deliveries<br><em>in motion.</em>'}</h1>
      <p>${role === 'admin' ? 'Approve requests, review delivery notes, and finalize stock deduction.' : 'Scan or enter a warehouse serial number, request delivery, then upload the signed delivery note after delivery.'}</p>
      ${role === 'delivery_guy' ? `<button class="primary" onclick="openDeliveryPicker()">＋ New delivery request</button>` : ''}
      ${role === 'admin' && unread ? `<button class="ghost" onclick="markNotificationsRead()">Mark ${unread} notification${unread>1?'s':''} read</button>` : ''}
    </section>
    ${role === 'admin' ? `<section class="panel glass"><div class="head"><div><small class="section-label">NOTIFICATIONS</small><h2>Alerts</h2></div><span class="pill">${unread} unread</span></div>${notifications.slice(0,8).map(n=>`<div class="notification-row ${n.read_at?'':'unread'}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><time>${timeAgo(getDateValue(n))}</time></div>`).join('') || empty('No notifications','You are up to date.')}</section>` : ''}
    <section class="panel glass"><div class="head"><div><small class="section-label">WORKFLOW</small><h2>${role==='admin'?'All deliveries':'My deliveries'}</h2></div><span class="pill">${mine.length} requests</span></div>${mine.map(d=>deliveryCard(d,role==='admin')).join('') || empty('No deliveries yet', role==='admin'?'Delivery requests will appear here.':'Create your first delivery request.')}</section>
  `;
}

function openDeliveryPicker() {
  const available = units.filter(u=>u.status==='available');
  if (!available.length) {
    toast('No serial-numbered inventory is available.', 'error');
    return;
  }
  view.innerHTML = `
    <section class="hero compact"><span class="eyebrow">SCAN / ENTER SERIAL</span><h1>Select the<br><em>physical item.</em></h1><p>Search the warehouse serial number. The selected unit will be reserved only after admin approval.</p></section>
    <section class="panel glass"><div class="head"><div><small class="section-label">AVAILABLE UNITS</small><h2>Serial number</h2></div><input id="serialSearch" class="search" placeholder="Type / scan serial…" autofocus></div><div id="unitPicker" class="unit-picker">${available.map(unitPickerCard).join('')}</div></section>`;
  $('serialSearch').oninput=()=>{
    const q=$('serialSearch').value.trim().toLowerCase();
    $('unitPicker').innerHTML=available.filter(u=>u.serial_number.toLowerCase().includes(q) || (u.products?.name||'').toLowerCase().includes(q)).map(unitPickerCard).join('') || empty('No matching serial','Try another serial number.');
  };
}

function unitPickerCard(u) {
  const p=u.products || {};
  return `<button type="button" class="unit-card" onclick="openDeliveryForUnit('${u.id}')"><span class="unit-icon">▣</span><span><b>${esc(p.name||'Item')}</b><small>${esc(u.serial_number)} · ${esc(p.location||'')}</small></span><span>→</span></button>`;
}

function openDeliveryForUnit(id) {
  const u=unitForDelivery(id);
  if(!u || u.status!=='available') return toast('That unit is no longer available.','error');
  const p=u.products||products.find(x=>x.id===u.product_id);
  $('deliveryUnitId').value=id;
  $('deliveryItemPreview').innerHTML=`<b>${esc(p?.name||'Item')}</b><span>Serial: ${esc(u.serial_number)}</span>`;
  $('dDestination').value=''; $('dRecipient').value=''; $('dDate').value=new Date().toISOString().slice(0,10); $('dNotes').value=''; $('deliveryMsg').textContent='';
  deliveryDialog.showModal();
}

async function notifyUser(recipientId,title,body,type,referenceId) {
  if(!sb || !recipientId) return;
  await sb.from('notifications').insert({recipient_id:recipientId,title,body,type,reference_id:referenceId});
}

async function approveDelivery(id) {
  if(!isAdmin) return;
  const {data,error}=await sb.rpc('approve_delivery_request',{request_id:id});
  if(error){toast(error.message,'error');return;}
  toast('Delivery approved. Item reserved.');
  await loadAll(); render();
}

async function rejectDelivery(id, afterNote=false) {
  if(!isAdmin) return;
  const reason=prompt('Optional rejection reason:')||'';
  const {error}=await sb.rpc('reject_delivery_request',{request_id:id,rejection_reason:reason});
  if(error){toast(error.message,'error');return;}
  toast('Delivery request rejected.');
  await loadAll(); render();
}

async function completeDelivery(id) {
  if(!isAdmin) return;
  const {data,error}=await sb.rpc('complete_delivery_request',{request_id:id});
  if(error){toast(error.message,'error');return;}
  toast('Delivery completed. Inventory deducted.');
  await loadAll(); render();
}

async function markNotificationsRead() {
  if(!user) return;
  const {error}=await sb.from('notifications').update({read_at:new Date().toISOString()}).eq('recipient_id',user.id).is('read_at',null);
  if(error) toast(error.message,'error'); else { await loadAll(); render(); }
}

async function uploadDeliveryNote(file) {
  if(!file) throw Error('Choose a delivery note first.');
  if(file.size>10*1024*1024) throw Error('File is larger than 10 MB.');
  const allowed=['image/png','image/jpeg','image/webp','application/pdf'];
  if(!allowed.includes(file.type)) throw Error('Use JPG, PNG, WEBP or PDF.');
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=`delivery-notes/${user.id}/${crypto.randomUUID()}.${ext}`;
  const up=await sb.storage.from('delivery-notes').upload(path,file,{upsert:false,contentType:file.type});
  if(up.error) throw up.error;
  return sb.storage.from('delivery-notes').getPublicUrl(path).data.publicUrl;
}

function openNote(id) {
  const d=deliveries.find(x=>x.id===id);
  if(!d) return;
  $('noteRequestId').value=id;
  $('noteRequestText').textContent=`${d.products?.name||'Item'} · Serial ${d.inventory_units?.serial_number||'—'} · ${d.destination}`;
  $('noteFile').value=''; $('noteNumber').value=''; $('noteNotes').value=''; $('noteMsg').textContent='';
  noteDialog.showModal();
}

$('deliveryForm').onsubmit=async e=>{
  e.preventDefault();
  if(role!=='delivery_guy') return;
  const btn=$('submitDelivery'); busy(btn,true,'Sending…'); $('deliveryMsg').textContent='';
  try{
    const unit=unitForDelivery($('deliveryUnitId').value);
    if(!unit || unit.status!=='available') throw Error('Selected item is no longer available.');
    const {data,error}=await sb.from('delivery_requests').insert({
      delivery_guy_id:user.id, product_id:unit.product_id, unit_id:unit.id,
      destination:$('dDestination').value.trim(), recipient:$('dRecipient').value.trim(),
      delivery_date:$('dDate').value, notes:$('dNotes').value.trim()
    }).select().single();
    if(error) throw error;
    deliveryDialog.close(); toast('Request sent to admin.');
    await loadAll(); go('deliveries');
  }catch(err){$('deliveryMsg').textContent=err.message||String(err);}
  finally{busy(btn,false);}
};

$('noteForm').onsubmit=async e=>{
  e.preventDefault();
  if(role!=='delivery_guy') return;
  const btn=$('submitNote'); busy(btn,true,'Uploading…'); $('noteMsg').textContent='';
  try{
    const url=await uploadDeliveryNote($('noteFile').files[0]);
    const {error}=await sb.from('delivery_requests').update({
      status:'delivery_note_submitted',delivery_note_url:url,
      delivery_note_number:$('noteNumber').value.trim(),driver_notes:$('noteNotes').value.trim(),
      delivered_at:new Date().toISOString()
    }).eq('id',$('noteRequestId').value).eq('delivery_guy_id',user.id);
    if(error) throw error;
    noteDialog.close(); toast('Delivery note submitted for admin review.');
    await loadAll(); go('deliveries');
  }catch(err){$('noteMsg').textContent=err.message||String(err);}
  finally{busy(btn,false);}
};

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



function manageSerials(productId) {
  if(!isAdmin) return;
  const p=products.find(x=>x.id===productId);
  if(!p) return;
  $('serialTitle').textContent=`Serials · ${p.name}`;
  $('serialForm').dataset.productId=productId;
  $('serialList').value=units.filter(u=>u.product_id===productId).map(u=>u.serial_number).join('\n');
  $('serialMsg').textContent='';
  serialDialog.showModal();
}

$('serialForm').onsubmit=async e=>{
  e.preventDefault();
  if(!isAdmin) return;
  const productId=$('serialForm').dataset.productId;
  const serials=[...new Set($('serialList').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
  const btn=$('saveSerials'); busy(btn,true,'Saving…'); $('serialMsg').textContent='';
  try{
    const {data:existing,error:exErr}=await sb.from('inventory_units').select('id,serial_number,status').eq('product_id',productId);
    if(exErr) throw exErr;
    const keep=new Set(serials);
    const deletable=(existing||[]).filter(u=>!keep.has(u.serial_number)&&u.status==='available').map(u=>u.id);
    if(deletable.length){const {error}=await sb.from('inventory_units').delete().in('id',deletable); if(error) throw error;}
    const existingSerials=new Set((existing||[]).map(u=>u.serial_number));
    const add=serials.filter(s=>!existingSerials.has(s)).map(serial_number=>({product_id:productId,serial_number,status:'available'}));
    if(add.length){const {error}=await sb.from('inventory_units').insert(add); if(error) throw error;}
    const {error:qtyErr}=await sb.from('products').update({quantity:serials.length}).eq('id',productId);
    if(qtyErr) throw qtyErr;
    serialDialog.close(); toast('Serials updated.'); await loadAll(); render();
  }catch(err){$('serialMsg').textContent=err.message||String(err);}
  finally{busy(btn,false);}
};

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
   START
========================= */

boot();
