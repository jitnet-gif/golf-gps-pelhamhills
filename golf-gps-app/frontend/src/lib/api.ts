import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

class ApiClient {
  private client: AxiosInstance;
  private requestInterceptorId?: number;
  private responseInterceptorId?: number;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor
    this.requestInterceptorId = this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.responseInterceptorId = this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        // Handle specific error cases
        if (error.response?.status === 401) {
          // Unauthorized - clear token and redirect
          localStorage.removeItem('auth_token');
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * GET request
   */
  async get<T>(
    url: string,
    params?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.get<T>(url, { params });
      return {
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      return this.handleError<T>(error);
    }
  }

  /**
   * POST request
   */
  async post<T>(
    url: string,
    data?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.post<T>(url, data);
      return {
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      return this.handleError<T>(error);
    }
  }

  /**
   * PUT request
   */
  async put<T>(
    url: string,
    data?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.put<T>(url, data);
      return {
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      return this.handleError<T>(error);
    }
  }

  /**
   * DELETE request
   */
  async delete<T>(url: string): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.delete<T>(url);
      return {
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      return this.handleError<T>(error);
    }
  }

  /**
   * Handle API errors
   */
  private handleError<T>(error: unknown): ApiResponse<T> {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message ||
        error.response?.statusText ||
        error.message ||
        'Unknown error';
      return {
        error: String(errorMessage),
        status: error.response?.status || 500,
      };
    }

    return {
      error: 'Failed to connect to server',
      status: 0,
    };
  }

  /**
   * Cleanup interceptors
   */
  destroy() {
    if (this.requestInterceptorId !== undefined) {
      this.client.interceptors.request.eject(this.requestInterceptorId);
    }
    if (this.responseInterceptorId !== undefined) {
      this.client.interceptors.response.eject(this.responseInterceptorId);
    }
  }
}

export const apiClient = new ApiClient();

// Export common API methods
export const api = {
  courses: {
    list: () => apiClient.get('/courses'),
    get: (id: string) => apiClient.get(`/courses/${id}`),
    holes: (courseId: string) =>
      apiClient.get(`/courses/${courseId}/holes`),
  },

  games: {
    create: (data: { courseId: string }) =>
      apiClient.post('/games', data),
    get: (id: string) => apiClient.get(`/games/${id}`),
    list: () => apiClient.get('/games'),
  },

  scores: {
    create: (data: { gameId: string; hole: number; score: number }) =>
      apiClient.post('/scores', data),
    update: (id: string, data: { score: number }) =>
      apiClient.put(`/scores/${id}`, data),
    delete: (id: string) => apiClient.delete(`/scores/${id}`),
  },

  health: () => apiClient.get('/health'),
};
