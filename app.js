// Global state
let currentUser = null;
let userRole = 'guest';

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthState();
    await loadProducts();
});

// Check Current Authentication State & Role
async function checkAuthState() {
    if (!supabaseClient) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        await fetchUserRole(currentUser);
    } else {
        currentUser = null;
        userRole = 'guest';
    }

    updateUI();
}

// Fetch Role from Profiles or User Metadata
async function fetchUserRole(user) {
    try {
        // First check profile table
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (data && data.role) {
            userRole = data.role;
        } else if (user.user_metadata && user.user_metadata.role) {
            userRole = user.user_metadata.role;
        } else {
            // Default check if email starts with admin
            userRole = (user.email && user.email.includes('admin')) ? 'admin' : 'user';
        }
    } catch (err) {
        console.warn('Could not fetch role, fallback to metadata/email:', err);
        userRole = (user.email && user.email.includes('admin')) ? 'admin' : 'user';
    }
}

// Update UI elements based on User Role
function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const userInfo = document.getElementById('user-info');
    const adminPanel = document.getElementById('admin-panel');
    const authSection = document.getElementById('auth-section');
    const adminElements = document.querySelectorAll('.admin-only');

    if (currentUser) {
        if (authBtn) authBtn.textContent = 'تسجيل الخروج';
        if (userInfo) {
            userInfo.style.display = 'inline-block';
            userInfo.textContent = `${currentUser.email} (${userRole})`;
        }
        if (authSection) authSection.style.display = 'none';

        if (userRole === 'admin') {
            if (adminPanel) adminPanel.style.display = 'block';
            adminElements.forEach(el => el.style.display = 'table-cell');
        } else {
            if (adminPanel) adminPanel.style.display = 'none';
            adminElements.forEach(el => el.style.display = 'none');
        }
    } else {
        if (authBtn) authBtn.textContent = 'تسجيل الدخول';
        if (userInfo) userInfo.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        adminElements.forEach(el => el.style.display = 'none');
    }
}

// Toggle Auth Form Modal/Section
function handleAuthAction() {
    const authSection = document.getElementById('auth-section');
    if (currentUser) {
        // Logout
        supabaseClient.auth.signOut().then(() => {
            currentUser = null;
            userRole = 'guest';
            updateUI();
            loadProducts();
        });
    } else {
        if (authSection) {
            authSection.style.display = authSection.style.display === 'none' ? 'block' : 'none';
        }
    }
}

// Handle Login Form Submit
async function handleAuthSubmit(e) {
    e.preventDefault();
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorDiv = document.getElementById('auth-error');

    if (!emailInput || !passwordInput) return;

    const email = emailInput.value;
    const password = passwordInput.value;

    if (errorDiv) errorDiv.style.display = 'none';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        currentUser = data.user;
        await fetchUserRole(currentUser);
        updateUI();
        loadProducts();
    } catch (err) {
        if (errorDiv) {
            errorDiv.textContent = err.message || 'حدث خطأ أثناء تسجيل الدخول';
            errorDiv.style.display = 'block';
        }
    }
}

// Load Products from Supabase
async function loadProducts() {
    const spinner = document.getElementById('loading-spinner');
    const tbody = document.getElementById('products-tbody');
    
    if (spinner) spinner.style.display = 'block';
    if (tbody) tbody.innerHTML = '';

    try {
        const { data: products, error } = await supabaseClient
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        if (spinner) spinner.style.display = 'none';

        if (error) {
            console.error('Error fetching products:', error);
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">خطأ في تحميل المنتجات أو لا توجد صلاحية للوصول.</td></tr>`;
            return;
        }

        if (!products || products.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">لا توجد منتجات حالياً.</td></tr>`;
            return;
        }

        if (tbody) {
            products.forEach((prod, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td><strong>${escapeHtml(prod.name)}</strong></td>
                    <td>${escapeHtml(prod.category || 'عام')}</td>
                    <td>$${parseFloat(prod.price).toFixed(2)}</td>
                    <td>${prod.stock}</td>
                    <td class="admin-only" style="display: ${userRole === 'admin' ? 'table-cell' : 'none'};">
                        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${prod.id}')">حذف</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

    } catch (err) {
        if (spinner) spinner.style.display = 'none';
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">تعذر الاتصال بقاعدة البيانات.</td></tr>`;
    }
}

// Handle Adding Product (Admin Only)
async function handleAddProduct(e) {
    e.preventDefault();

    if (userRole !== 'admin') {
        alert('غير مصرح لك بتنفيذ هذا الإجراء');
        return;
    }

    const name = document.getElementById('prod-name').value;
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value);
    const category = document.getElementById('prod-category') ? document.getElementById('prod-category').value : 'عام';

    const btn = document.getElementById('save-prod-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'جاري الحفظ...';
    }

    try {
        const { data, error } = await supabaseClient
            .from('products')
            .insert([{ name, price, stock, category }]);

        if (error) throw error;

        alert('تمت إضافة المنتج بنجاح!');
        const form = document.getElementById('add-product-form');
        if (form) form.reset();
        await loadProducts();
    } catch (err) {
        alert('خطأ أثناء إضافة المنتج: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '➕ إضافة المنتج للمستودع';
        }
    }
}

// Handle Delete Product (Admin Only)
async function deleteProduct(id) {
    if (!confirm('هل أنت تأكد من رغبتك في حذف هذا المنتج؟')) return;

    try {
        const { error } = await supabaseClient
            .from('products')
            .delete()
            .eq('id', id);

        if (error) throw error;

        alert('تم حذف المنتج بنجاح');
        await loadProducts();
    } catch (err) {
        alert('خطأ أثناء الحذف: ' + err.message);
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
