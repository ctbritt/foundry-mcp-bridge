import { MODULE_ID } from './constants.js';
import { RunPodClient } from './runpod-client.js';

/**
 * ComfyUI Service Manager - adapted from working foundry-mcp-mapgen implementation
 * Now supports both local ComfyUI and RunPod serverless backends
 */
export class ComfyUIManager {
  private serviceStatus: string = 'unknown';
  private isStarting: boolean = false;
  private runpodClient: RunPodClient | null = null;

  async checkStatus(): Promise<{ status: string; message?: string; phase?: string }> {
    try {
      // Always route through backend to avoid CORS issues
      const backendStatus = await this.requestBackendStatus();
      this.serviceStatus = backendStatus.status;
      return backendStatus;
    } catch (error) {
      this.serviceStatus = 'stopped';
      return {
        status: 'stopped',
        message: error instanceof Error ? error.message : 'Service not available'
      };
    }
  }

  async startService(): Promise<{ status: string; message?: string; phase?: string }> {
    if (this.isStarting) return { status: 'starting', message: 'Service start already in progress' };

    this.isStarting = true;
    this.serviceStatus = 'starting';

    try {
      // Use backend to start ComfyUI if MCP bridge is connected
      const bridge = (globalThis as any).foundryMCPBridge;
      if (bridge?.socketBridge?.isConnected()) {
        return await this.startServiceWithProgress();
      } else {
        // Fallback: Check if already running and show manual start message
        const status = await this.checkStatus();

        if (status.status === 'running') {
          ui.notifications?.info('ComfyUI service is already running');
          return status;
        } else {
          const helpMessage = 'MCP backend not connected. Please ensure Claude Desktop is running with the foundry-mcp server configured, then try again.';
          ui.notifications?.warn(helpMessage);
          console.log(`[${MODULE_ID}] Backend connection issue - check Claude Desktop MCP server configuration`);
          return { status: 'backend_unavailable', message: helpMessage };
        }
      }
    } catch (error) {
      this.serviceStatus = 'error';
      const errorMessage = `Failed to start ComfyUI service: ${error instanceof Error ? error.message : 'Unknown error'}`;
      const helpMessage = error instanceof Error && error.message.includes('timeout') ?
        errorMessage + ' This is normal for first-time startup. Try checking the service status in a few minutes.' :
        errorMessage + ' Check the console for more details and verify your ComfyUI installation.';

      ui.notifications?.error(helpMessage);
      console.error(`[${MODULE_ID}] Service start error:`, error);
      return { status: 'error', message: helpMessage };
    } finally {
      this.isStarting = false;
    }
  }

  async startServiceWithProgress(): Promise<{ status: string; message?: string; phase?: string }> {
    // Show initial progress notification
    ui.notifications?.info('Starting ComfyUI service...');

    const maxWaitTime = 90000; // 90 seconds total timeout
    const pollInterval = 5000; // Poll every 5 seconds
    const startTime = Date.now();
    let lastNotificationTime = 0;

    // Send the initial start request (but don't wait for full completion)
    let serviceStartRequested = false;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Send start request only once
        if (!serviceStartRequested) {
          // Start the service in background (don't await full completion)
          this.requestBackendStartService().catch(() => {}); // Ignore errors here, we'll check status instead
          serviceStartRequested = true;
          console.log(`[${MODULE_ID}] ComfyUI service start requested`);
        }

        // Check current service status
        const status = await this.requestBackendStatus();
        this.serviceStatus = status.status;

        // If service is ready, return success
        if (status.status === 'running' || status.status === 'already_running') {
          const successMessage = status.phase === 'ready' ?
            'ComfyUI service is ready for AI map generation!' :
            'ComfyUI service started successfully!';

          ui.notifications?.info(successMessage);
          console.log(`[${MODULE_ID}] ${successMessage} (${Math.round((Date.now() - startTime)/1000)}s startup time)`);
          return status;
        }

        // Show progress updates every 15 seconds to avoid notification spam
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime - lastNotificationTime >= 15000) {
          const remainingTime = Math.max(0, Math.round((maxWaitTime - elapsedTime) / 1000));
          let message = 'ComfyUI service starting...';

          // Use phase information for more accurate status messages
          if (status.phase) {
            switch (status.phase) {
              case 'starting':
                message = 'Starting ComfyUI service - launching process...';
                break;
              case 'loading':
                message = 'ComfyUI loading AI models (this may take a while)...';
                break;
              case 'ready':
                message = 'ComfyUI service ready!';
                break;
              default:
                message = status.message || 'ComfyUI service starting...';
            }
          } else {
            // Fallback to time-based messages if no phase info
            if (elapsedTime < 30000) {
              message = 'Starting ComfyUI service...';
            } else if (elapsedTime < 60000) {
              message = 'Loading AI models (this may take a while)...';
            } else {
              message = `Still loading... (${remainingTime}s remaining)`;
            }
          }

          ui.notifications?.info(message);
          lastNotificationTime = elapsedTime;
          console.log(`[${MODULE_ID}] ${message} (${Math.round(elapsedTime/1000)}s elapsed, phase: ${status.phase || 'unknown'})`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.warn(`[${MODULE_ID}] Status check failed during startup:`, error instanceof Error ? error.message : 'Unknown error');

        // If we can't check status, continue waiting (service might still be starting)
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // Timeout reached - check one final time
    try {
      const finalStatus = await this.requestBackendStatus();
      if (finalStatus.status === 'running' || finalStatus.status === 'already_running') {
        const finalMessage = 'ComfyUI service started successfully after extended startup time! ' +
                            'Future startups should be faster as models are now cached.';
        ui.notifications?.info(finalMessage);
        console.log(`[${MODULE_ID}] Extended startup completed - service now ready`);
        return finalStatus;
      }
    } catch (error) {
      // Ignore final check errors - will fall through to timeout message
      console.log(`[${MODULE_ID}] Final status check failed:`, error instanceof Error ? error.message : 'Unknown error');
    }

    // Service failed to start within timeout
    this.serviceStatus = 'timeout';
    const timeoutMessage = 'ComfyUI service startup timed out after 90 seconds. ' +
                          'The service may still be starting in the background - try checking status again in a moment. ' +
                          'First-time startup with model downloads can take several minutes.';
    ui.notifications?.warn(timeoutMessage);
    console.log(`[${MODULE_ID}] Service startup timeout - this is normal for first-time startup or slower machines`);
    return { status: 'timeout', message: timeoutMessage };
  }

  async stopService(): Promise<{ status: string; message?: string }> {
    try {
      // Use backend to stop ComfyUI if MCP bridge is connected
      const bridge = (globalThis as any).foundryMCPBridge;
      if (bridge?.socketBridge?.isConnected()) {
        const result = await this.requestBackendStopService();
        this.serviceStatus = result.status;

        if (result.status === 'stopped' || result.status === 'already_stopped') {
          ui.notifications?.info(`ComfyUI service stopped: ${result.message}`);
        } else {
          ui.notifications?.warn(`ComfyUI service could not be stopped: ${result.message || 'Unknown error'}`);
        }

        return result;
      } else {
        ui.notifications?.warn('MCP backend not connected. Cannot stop service remotely.');
        return { status: 'backend_unavailable', message: 'MCP backend not connected' };
      }
    } catch (error) {
      this.serviceStatus = 'error';
      ui.notifications?.error(`Failed to stop ComfyUI service: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Helper methods for backend communication
  private async requestBackendStatus(): Promise<{ status: string; message?: string; phase?: string }> {
    return await this.sendBackendRequest('check-comfyui-status');
  }

  private async requestBackendStartService(): Promise<{ status: string; message?: string; phase?: string }> {
    return await this.sendBackendRequest('start-comfyui-service');
  }

  private async requestBackendStopService(): Promise<{ status: string; message?: string }> {
    return await this.sendBackendRequest('stop-comfyui-service');
  }

  private async sendBackendRequest(type: string, data: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const bridge = (globalThis as any).foundryMCPBridge;

      // Fix connection check condition - use the bridge's connection state
      if (!bridge?.socketBridge?.isConnected()) {
        reject(new Error('MCP backend not connected'));
        return;
      }

      const requestId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timeout = 90000; // 90 second timeout for ComfyUI startup
      let isResolved = false;

      const cleanup = () => {
        if (eventHandler) {
          if (bridge.socketBridge?.ws) {
            bridge.socketBridge.ws.removeEventListener('message', eventHandler);
          } else if (bridge.socketBridge?.webrtc?.dataChannel) {
            bridge.socketBridge.webrtc.dataChannel.removeEventListener('message', eventHandler);
          }
        }
      };

      const timeoutHandle = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error(`Request ${type} timed out after ${timeout}ms`));
        }
      }, timeout);

      // Create event handler function for proper cleanup
      const eventHandler = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data);

          // Check for exact response match
          if (message.requestId === requestId) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeoutHandle);
              cleanup();

              if (message.error) {
                reject(new Error(message.error));
              } else {
                resolve(message);
              }
            }
          }
        } catch (error) {
          // Ignore parse errors for other messages
        }
      };

      // Register response handler - works for both WebSocket and WebRTC
      try {
        // Add listener based on connection type
        if (bridge.socketBridge.ws) {
          // WebSocket mode
          bridge.socketBridge.ws.addEventListener('message', eventHandler);
        } else if (bridge.socketBridge.webrtc?.dataChannel) {
          // WebRTC mode
          bridge.socketBridge.webrtc.dataChannel.addEventListener('message', eventHandler);
        } else {
          throw new Error('No active connection (neither WebSocket nor WebRTC)');
        }
      } catch (error) {
        isResolved = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to register response handler: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return;
      }

      // Send request with error handling
      try {
        const request = {
          type,
          requestId,
          data: data
        };

        bridge.socketBridge.sendMessage(request);

        // Log request for debugging
        console.log(`[${MODULE_ID}] Sent backend request:`, { type, requestId });

      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutHandle);
          cleanup();
          reject(new Error(`Failed to send request: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      }
    });
  }

  getServiceStatus(): string {
    return this.serviceStatus;
  }

  /**
   * Get the configured service type
   */
  private getServiceType(): 'local' | 'runpod' {
    return (game.settings.get(MODULE_ID, 'mapGenServiceType') as 'local' | 'runpod') || 'local';
  }

  /**
   * Initialize RunPod client if needed
   */
  private initializeRunPodClient(): RunPodClient | null {
    if (this.runpodClient) {
      return this.runpodClient;
    }

    const apiKey = game.settings.get(MODULE_ID, 'runpodApiKey') as string;
    const endpointId = game.settings.get(MODULE_ID, 'runpodEndpoint') as string;

    if (!apiKey || !endpointId) {
      console.error(`[${MODULE_ID}] RunPod API key or endpoint not configured`);
      return null;
    }

    this.runpodClient = new RunPodClient(apiKey, endpointId);
    return this.runpodClient;
  }

  /**
   * Start polling RunPod job and handle completion
   */
  private async pollRunPodJob(jobId: string, params: { scene_name: string; grid_size: number }): Promise<void> {
    const client = this.initializeRunPodClient();
    if (!client) return;

    console.log(`[${MODULE_ID}] Starting RunPod job polling for ${jobId}`);

    const maxPolls = 60; // 5 minutes at 5 second intervals
    let pollCount = 0;

    while (pollCount < maxPolls) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      pollCount++;

      const statusResult = await client.checkStatus(jobId);
      if (!statusResult.success) {
        console.error(`[${MODULE_ID}] Failed to check RunPod status:`, statusResult.error);
        return;
      }

      const job = statusResult.job;
      console.log(`[${MODULE_ID}] RunPod job status poll ${pollCount}:`, job.status);

      if (job.status === 'complete') {
        console.log(`[${MODULE_ID}] RunPod job completed, processing result`);
        await this.handleRunPodCompletion(jobId, job, params);
        return;
      } else if (job.status === 'failed') {
        console.error(`[${MODULE_ID}] RunPod job failed:`, job.error);
        ui.notifications?.error(`Map generation failed: ${job.error || 'Unknown error'}`);
        return;
      }
    }

    console.error(`[${MODULE_ID}] RunPod job polling timeout after ${maxPolls} polls`);
    ui.notifications?.warn('Map generation timed out. Check RunPod dashboard for status.');
  }

  /**
   * Handle RunPod job completion - extract image and create scene
   */
  private async handleRunPodCompletion(_jobId: string, job: any, params: { scene_name: string; grid_size: number }): Promise<void> {
    try {
      const client = this.initializeRunPodClient();
      if (!client) return;

      console.log(`[${MODULE_ID}] RunPod job result structure:`, JSON.stringify(job, null, 2));

      // Extract image from RunPod output
      if (!job.result) {
        throw new Error('No result in RunPod output');
      }

      if (!job.result.images) {
        console.error(`[${MODULE_ID}] No images field in result. Result keys:`, Object.keys(job.result));
        throw new Error('No images in RunPod output');
      }

      if (!Array.isArray(job.result.images) || job.result.images.length === 0) {
        throw new Error('Images array is empty in RunPod output');
      }

      const imageData = job.result.images[0];
      console.log(`[${MODULE_ID}] Downloading image from RunPod, type:`, typeof imageData);

      // Download and convert to base64
      const base64Image = await client.downloadImage(imageData);

      // Create filename
      const timestamp = Date.now();
      const filename = `runpod-battlemap-${timestamp}.png`;

      console.log(`[${MODULE_ID}] Uploading image to Foundry: ${filename}`);

      // Upload to Foundry using existing upload handler
      const bridge = (globalThis as any).foundryMCPBridge;
      if (bridge?.queryHandlers) {
        const uploadResult = await bridge.queryHandlers.handleUploadGeneratedMap({
          filename: filename,
          imageData: base64Image
        });

        if (!uploadResult.success) {
          throw new Error(`Upload failed: ${uploadResult.error}`);
        }

        const imagePath = uploadResult.path;
        console.log(`[${MODULE_ID}] Image uploaded successfully: ${imagePath}`);

        // Create scene with the uploaded image
        const sceneName = params.scene_name;
        const gridSize = params.grid_size;

        console.log(`[${MODULE_ID}] Creating scene: ${sceneName} with image: ${imagePath}`);

        // Create minimal scene first
        const sceneData: any = {
          name: sceneName,
          padding: 0.1
        };

        const scene = await Scene.create(sceneData);
        console.log(`[${MODULE_ID}] Scene created with ID:`, scene?.id);

        // CRITICAL: Foundry v14 requires updating the scene after creation to set background
        if (scene) {
          console.log(`[${MODULE_ID}] Updating scene with background image and grid`);
          const updateData = {
            'background.src': imagePath,
            'grid.size': gridSize,
            'grid.distance': 5,
            'grid.units': 'ft'
          };
          console.log(`[${MODULE_ID}] Update data:`, updateData);

          await scene.update(updateData);
          console.log(`[${MODULE_ID}] Scene updated successfully`);

          // Verify the update worked
          const updated = game.scenes.get(scene.id) as any;
          console.log(`[${MODULE_ID}] Verification - background.src:`, updated?.background?.src);
        }

        ui.notifications?.info(`Map "${sceneName}" created successfully!`);
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Error handling RunPod completion:`, error);
      ui.notifications?.error(`Failed to process generated map: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a map using ComfyUI (local or RunPod)
   */
  async generateMap(data: { prompt: string; scene_name: string; size?: string; grid_size?: number; quality?: string; twoStage?: boolean }): Promise<any> {
    try {
      const serviceType = this.getServiceType();
      console.log(`[${MODULE_ID}] Generating map using ${serviceType} service`);

      if (serviceType === 'runpod') {
        // Use RunPod serverless
        const client = this.initializeRunPodClient();
        if (!client) {
          return {
            success: false,
            error: 'RunPod not configured. Please set API key and endpoint in settings.'
          };
        }

        const result = await client.generateMap({
          prompt: data.prompt,
          scene_name: data.scene_name,
          size: data.size || 'medium',
          grid_size: data.grid_size || 70,
          quality: data.quality || 'low',
          twoStage: data.twoStage || false
        });

        // Start background polling to handle completion
        if (result.success && result.jobId) {
          this.pollRunPodJob(result.jobId, {
            scene_name: data.scene_name,
            grid_size: data.grid_size || 70
          }).catch(error => {
            console.error(`[${MODULE_ID}] Error in RunPod polling:`, error);
          });
        }

        return result;
      } else {
        // Use local ComfyUI via backend
        const bridge = (globalThis as any).foundryMCPBridge;
        if (!bridge?.socketBridge?.isConnected()) {
          return { success: false, error: 'Backend not connected' };
        }

        return await this.sendBackendRequest('generate-map-request', data);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Map generation failed'
      };
    }
  }

  /**
   * Check status of a map generation job
   */
  async checkMapStatus(data: { job_id: string }): Promise<any> {
    try {
      const serviceType = this.getServiceType();

      if (serviceType === 'runpod') {
        // Use RunPod serverless
        const client = this.initializeRunPodClient();
        if (!client) {
          return {
            success: false,
            error: 'RunPod not configured. Please set API key and endpoint in settings.'
          };
        }

        return await client.checkStatus(data.job_id);
      } else {
        // Use local ComfyUI via backend
        const bridge = (globalThis as any).foundryMCPBridge;
        if (!bridge?.socketBridge?.isConnected()) {
          return { success: false, error: 'Backend not connected' };
        }

        return await this.sendBackendRequest('check-map-status-request', data);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Status check failed'
      };
    }
  }

  /**
   * Cancel a map generation job
   */
  async cancelMapJob(data: { job_id: string }): Promise<any> {
    try {
      const serviceType = this.getServiceType();

      if (serviceType === 'runpod') {
        // Use RunPod serverless
        const client = this.initializeRunPodClient();
        if (!client) {
          return {
            success: false,
            error: 'RunPod not configured. Please set API key and endpoint in settings.'
          };
        }

        return await client.cancelJob(data.job_id);
      } else {
        // Use local ComfyUI via backend
        const bridge = (globalThis as any).foundryMCPBridge;
        if (!bridge?.socketBridge?.isConnected()) {
          return { success: false, error: 'Backend not connected' };
        }

        return await this.sendBackendRequest('cancel-map-job-request', data);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Job cancellation failed'
      };
    }
  }
}