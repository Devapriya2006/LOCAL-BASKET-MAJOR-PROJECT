// ─── LocalBasket API Client ──────────────────────────────────────────────────
// Auto-detect: if served from port 5000, use same origin; otherwise point to 5000
const API_BASE = window.location.port === '5000'
  ? `${window.location.protocol}//${window.location.hostname}:5000/api`
  : 'http://localhost:5000/api';

const api = {
  getToken: () => localStorage.getItem('lb_token'),
  getUser: () => JSON.parse(localStorage.getItem('lb_user') || 'null'),

  setAuth: (token, user) => {
    localStorage.setItem('lb_token', token);
    localStorage.setItem('lb_user', JSON.stringify(user));
  },

  clearAuth: () => {
    localStorage.removeItem('lb_token');
    localStorage.removeItem('lb_user');
  },

  isLoggedIn: () => !!localStorage.getItem('lb_token'),

  headers: (auth = true) => {
    const h = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = localStorage.getItem('lb_token');
      if (token) h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  },

  request: async (method, path, data = null, auth = true) => {
    const options = { method, headers: api.headers(auth) };
    if (data) options.body = JSON.stringify(data);

    try {
      const res = await fetch(`${API_BASE}${path}`, options);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Request failed');
      return json;
    } catch (err) {
      throw err;
    }
  },

  get: (path, auth = true) => api.request('GET', path, null, auth),
  post: (path, data, auth = true) => api.request('POST', path, data, auth),
  put: (path, data, auth = true) => api.request('PUT', path, data, auth),
  delete: (path, auth = true) => api.request('DELETE', path, null, auth),

  // Auth
  auth: {
    register: (data) => api.post('/auth/register', data, false),
    login: (data) => api.post('/auth/login', data, false),
    me: () => api.get('/auth/me'),
    updateProfile: (data) => api.put('/auth/profile', data),
    changePassword: (data) => api.put('/auth/change-password', data),
  },

  // Products
  products: {
    getAll: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return api.get(`/products${query ? '?' + query : ''}`, false);
    },
    getById: (id) => api.get(`/products/${id}`, false),
    create: (data) => api.post('/products', data),
    update: (id, data) => api.put(`/products/${id}`, data),
    delete: (id) => api.delete(`/products/${id}`),
    addReview: (id, data) => api.post(`/products/${id}/review`, data),
    getStats: () => api.get('/products/farmer/stats'),
  },

  // Cart
  cart: {
    get: () => api.get('/cart'),
    add: (productId, quantity) => api.post('/cart', { productId, quantity }),
    update: (productId, quantity) => api.put(`/cart/${productId}`, { quantity }),
    remove: (productId) => api.delete(`/cart/${productId}`),
    clear: () => api.delete('/cart'),
  },

  // Orders
  orders: {
    getAll: () => api.get('/orders'),
    getById: (id) => api.get(`/orders/${id}`),
    place: (data) => api.post('/orders', data),
    updateStatus: (id, status, note) => api.put(`/orders/${id}/status`, { status, note }),
    cancel: (id, reason) => api.put(`/orders/${id}/cancel`, { reason }),
    getStats: () => api.get('/orders/farmer/stats'),
  },

  // Users
  users: {
    getAll: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return api.get(`/users${query ? '?' + query : ''}`);
    },
    getFarmers: (params = {}) => {
      const query = new URLSearchParams(params).toString();
      return api.get(`/users/farmers${query ? '?' + query : ''}`, false);
    },
    getById: (id) => api.get(`/users/${id}`),
    toggleStatus: (id) => api.put(`/users/${id}/toggle`, {}),
  },

  // Admin / DB Viewer
  admin: {
    getStats: () => api.get('/admin/db-stats'),
    getCollections: () => api.get('/admin/collections'),
    getCollection: (name, params = {}) => {
      const query = new URLSearchParams(params).toString();
      return api.get(`/admin/collection/${name}${query ? '?' + query : ''}`);
    },
    getDocument: (collection, id) => api.get(`/admin/collection/${collection}/${id}`),
    deleteDocument: (collection, id) => api.delete(`/admin/collection/${collection}/${id}`),
  }
};

// ─── Navigation Helpers ───────────────────────────────────────────────────────
// Resolves the home page path regardless of how deeply nested the current page is.
const nav = {
  // Walk up the path segments until we find the root, then navigate to index.html
  goHome: () => {
    // Determine the depth of the current page relative to the site root.
    // Pages inside /pages/ are one level deep → go up one directory.
    const path = window.location.pathname;
    const inPagesDir = path.includes('/pages/');
    const homePath = inPagesDir ? '../index.html' : '/index.html';
    window.location.href = homePath;
  },

  // Navigate to any page within /pages/
  goTo: (page) => {
    const path = window.location.pathname;
    const inPagesDir = path.includes('/pages/');
    window.location.href = inPagesDir ? page : `pages/${page}`;
  },

  // Go back in browser history, falling back to home if no history exists
  goBack: () => {
    if (document.referrer && document.referrer !== window.location.href) {
      window.history.back();
    } else {
      nav.goHome();
    }
  },

  // Resolve the right dashboard for the signed-in role from root or /pages/.
  dashboardPath: (user) => {
    const page = user?.role === 'admin'
      ? 'admin-panel.html'
      : user?.role === 'farmer'
        ? 'farmer-dashboard.html'
        : 'customer-dashboard.html';
    return window.location.pathname.includes('/pages/') ? page : `pages/${page}`;
  },
};

// Toast notification system
const toast = {
  show: (message, type = 'info') => {
    const container = document.getElementById('toast-container') || (() => {
      const el = document.createElement('div');
      el.id = 'toast-container';
      document.body.appendChild(el);
      return el;
    })();

    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 3500);
  },
  success: (msg) => toast.show(msg, 'success'),
  error: (msg) => toast.show(msg, 'error'),
  warning: (msg) => toast.show(msg, 'warning'),
  info: (msg) => toast.show(msg, 'info'),
};

// Format helpers
const fmt = {
  currency: (n) => `₹${Number(n).toFixed(2)}`,
  date: (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  status: (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  stars: (r) => '★'.repeat(Math.floor(r)) + '☆'.repeat(5 - Math.floor(r)),
  relativeTime: (d) => {
    const diff = Date.now() - new Date(d);
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
};

// Redirect if not authenticated
const requireAuth = (role = null) => {
  if (!api.isLoggedIn()) {
    window.location.href = '/pages/login.html';
    return false;
  }
  const user = api.getUser();
  if (role && user.role !== role) {
    toast.error('Access denied');
    window.location.href = '/';
    return false;
  }
  return user;
};
