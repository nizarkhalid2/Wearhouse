window.WAREHOUSE_CONFIG = {
  SUPABASE_URL: "https://smbbhxankojvpmistdct.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_HUdlBXrjT0DSqs8MHNIjog_H6Wsn3fr",
  ADMIN_EMAIL: "admin@warehouse.com",
  STORAGE_BUCKET: "product-images"
};

// Initialize Supabase Client safely using WAREHOUSE_CONFIG
let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(
        window.WAREHOUSE_CONFIG.SUPABASE_URL, 
        window.WAREHOUSE_CONFIG.SUPABASE_ANON_KEY
    );
} else {
    console.error("Supabase SDK not loaded!");
}
