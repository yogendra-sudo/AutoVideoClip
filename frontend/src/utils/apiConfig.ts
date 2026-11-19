/**
 * API ConfigurationManager
 * Handle dynamic backend addresses and portsConfiguration
 */

interface ApiConfig {
  baseUrl: string;
  port: number;
  isReady: boolean;
}

class ApiConfigManager {
  private static instance: ApiConfigManager;
  private config: ApiConfig = {
    baseUrl: '/api/v1',
    port: 0,
    isReady: false
  };
  private listeners: Array<(config: ApiConfig) => void> = [];

  private constructor() {
    this.initializeConfig();
  }

  static getInstance(): ApiConfigManager {
    if (!ApiConfigManager.instance) {
      ApiConfigManager.instance = new ApiConfigManager();
    }
    return ApiConfigManager.instance;
  }

  private async initializeConfig() {
    // Check whetherGet it from the Tauri In the environment
    if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)) {
      try {
        // Monitor backend startup events
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        
        await listen('backend-started', (event: any) => {
          const backendStatus = event.payload;
          if (backendStatus && backendStatus.port) {
            this.updateFromPort(backendStatus.port);
          }
        });

        const backendStatus = await invoke('get_service_status') as any;
        if (backendStatus?.is_running && backendStatus?.port) {
          this.updateFromPort(backendStatus.port);
        }

        // Try to get it from the global variableConfiguration
        if ((window as any).__BACKEND_BASE__) {
          this.updateConfig({
            baseUrl: (window as any).__BACKEND_BASE__,
            port: this.extractPortFromUrl((window as any).__BACKEND_BASE__),
            isReady: true
          });
        }
      } catch (error) {
        console.warn('Unable to initialize Tauri Event Listener:', error);
      }
    }
  }

  private updateFromPort(port: number) {
    this.updateConfig({
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      port,
      isReady: true
    });
  }

  private extractPortFromUrl(url: string): number {
    const match = url.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private updateConfig(newConfig: Partial<ApiConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.notifyListeners();
  }

  private notifyListeners() {
    // waitForReady The listener willGet it from theInclude yourself in the callbackRemove；Direct forEach The original array will skip the next listener，
    // Resulting in the first in the queue during cold start 2、4… requests to wait 30s Sent after timeout（SettingsPageOnThat's why it's slow.）
    [...this.listeners].forEach(listener => listener(this.config));
  }

  /**
   * Get current API Configuration
   */
  getConfig(): ApiConfig {
    return { ...this.config };
  }

  /**
   * Obtain API Basic URL
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Check API Is it ready?
   */
  isReady(): boolean {
    return this.config.isReady;
  }

  /**
   * AddConfigurationChange listener
   */
  addListener(listener: (config: ApiConfig) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Waiting API Ready
   */
  async waitForReady(timeout: number = 30000, signal?: AbortSignal): Promise<boolean> {
    if (this.isReady()) {
      return true;
    }
    if (signal?.aborted) return false;

    return new Promise((resolve) => {
      const done = (ready: boolean) => {
        clearTimeout(timeoutId);
        removeListener();
        signal?.removeEventListener('abort', onAbort);
        resolve(ready);
      };
      const onAbort = () => done(false);
      const timeoutId = setTimeout(() => done(false), timeout);
      const removeListener = this.addListener((config) => {
        if (config.isReady) done(true);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Build a complete API URL
   */
  buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.config.baseUrl}${normalizedPath}`;
  }
}

// ExportSingleton instance
export const apiConfigManager = ApiConfigManager.getInstance();

// ExportConvenience function
export const isApiReady = () => apiConfigManager.isReady();
export const waitForApiReady = (timeout?: number) => apiConfigManager.waitForReady(timeout);
export const buildApiUrl = (path: string) => apiConfigManager.buildUrl(path);
