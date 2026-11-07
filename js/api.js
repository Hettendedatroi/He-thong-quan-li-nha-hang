/**
 * API Client cho Restaurant Management System
 * Base URL: http://localhost:3000/api
 * Tự động xử lý JWT authentication + refresh token
 */
(() => {
  const BASE_URL = 'http://localhost:3000/api';
  const STORAGE_KEYS = {
    ACCESS_TOKEN: 'restaurant_access_token',
    REFRESH_TOKEN: 'restaurant_refresh_token',
    USER: 'restaurant_user',
  };

  // State
  let isRefreshing = false;
  let refreshQueue = [];

  // ============== Storage helpers ==============
  const auth = {
    getAccessToken: () => localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
    getRefreshToken: () => localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    getUser: () => {
      const data = localStorage.getItem(STORAGE_KEYS.USER);
      return data ? JSON.parse(data) : null;
    },
    setTokens: (accessToken, refreshToken, user) => {
      localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      if (user) localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    },
    clear: () => {
      localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
    },
    isStaff: () => {
      const user = auth.getUser();
      return user && ['ADMIN', 'MANAGER', 'SENIOR_WAITER', 'WAITER', 'KITCHEN'].includes(user.roleCode);
    },
    hasPermission: (permission) => {
      const user = auth.getUser();
      if (!user?.role?.permissions) return false;
      return user.role.permissions.includes('*') || user.role.permissions.includes(permission);
    },
  };

  // ============== Request with auto-refresh ==============
  async function request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Gắn JWT nếu có (trừ endpoint public)
    const token = auth.getAccessToken();
    if (token && !endpoint.startsWith('/public/') && !endpoint.startsWith('/auth/')) {
      headers.Authorization = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers,
    };

    let response = await fetch(url, config);

    // Nếu 401 và có refresh token → thử refresh
    if (response.status === 401 && auth.getRefreshToken() && !endpoint.includes('/auth/refresh')) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        response = await fetch(url, { ...config, headers });
      } else {
        // Refresh thất bại → logout
        auth.clear();
        window.location.href = '/login.html';
        throw new Error('Phiên đăng nhập hết hạn');
      }
    }

    // Parse response
    const contentType = response.headers.get('content-type');
    let data;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const error = new Error(data.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  // Refresh token (chỉ gọi 1 lần nếu nhiều request đồng thời fail)
  async function refreshAccessToken() {
    if (isRefreshing) {
      return new Promise((resolve) => refreshQueue.push(resolve));
    }

    isRefreshing = true;
    try {
      const refreshToken = auth.getRefreshToken();
      if (!refreshToken) return null;

      const data = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).then((r) => r.json());

      if (data.accessToken) {
        auth.setTokens(data.accessToken, data.refreshToken, data.user);
        refreshQueue.forEach((cb) => cb(data.accessToken));
        refreshQueue = [];
        return data.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      isRefreshing = false;
    }
  }

  // ============== Convenience methods ==============
  const api = {
    auth,
    BASE_URL,

    get: (endpoint, params) => {
      const query = params ? '?' + new URLSearchParams(params).toString() : '';
      return request(endpoint + query, { method: 'GET' });
    },

    post: (endpoint, body) =>
      request(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    patch: (endpoint, body) =>
      request(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    delete: (endpoint) => request(endpoint, { method: 'DELETE' }),

    // Upload file (FormData)
    upload: (endpoint, formData) =>
      request(endpoint, {
        method: 'POST',
        headers: {}, // Để browser tự set Content-Type cho multipart
        body: formData,
      }),

    // Login (trả về { accessToken, refreshToken, user })
    login: async (identifier, password) => {
      const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      auth.setTokens(data.accessToken, data.refreshToken, data.user);
      return data;
    },

    // Logout
    logout: async () => {
      try {
        await request('/auth/logout', { method: 'POST' });
      } catch {}
      auth.clear();
      window.location.href = '/login.html';
    },

    // WebSocket helper (trả về socket.io client instance)
    connectSocket: () => {
      if (!window.io) {
        console.error('Socket.IO client chưa được load. Thêm <script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>');
        return null;
      }
      const token = auth.getAccessToken();
      return window.io('http://localhost:3000', {
        auth: { token },
      });
    },
  };

  // Export global
  window.api = api;
})();