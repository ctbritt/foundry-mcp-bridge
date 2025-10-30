import { MODULE_ID } from './constants.js';

export interface RunPodJobResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  output?: {
    images?: string[];
    message?: string;
  };
  error?: string;
}

export interface RunPodGenerateParams {
  prompt: string;
  scene_name: string;
  size: string;
  grid_size: number;
  quality: string;
  twoStage?: boolean; // Use two-stage workflow (base + upscale models)
}

export class RunPodClient {
  private apiKey: string;
  private endpointId: string;
  private baseUrl: string;

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.baseUrl = `https://api.runpod.ai/v2/${endpointId}`;
  }

  /**
   * Build a two-stage ComfyUI workflow:
   * 1. Generate base image with dDBattlemapsSDXL10_v10.safetensors
   * 2. Upscale and refine with dDBattlemapsSDXL10_upscaleV10.safetensors (img2img)
   */
  private buildTwoStageWorkflow(params: RunPodGenerateParams): Record<string, any> {
    // Map size to pixels - base resolution (will be upscaled)
    const baseSizeMap: Record<string, number> = {
      small: 512,   // Upscales to 1024
      medium: 768,  // Upscales to 1536
      large: 1024   // Upscales to 2048
    };
    const basePixels = baseSizeMap[params.size] || 768;

    // Enhanced prompt for D&D Battlemaps SDXL
    // const enhancedPrompt = `2d DnD battlemap of ${params.prompt}, top-down view, overhead perspective, aerial`;
    const enhancedPrompt = `High-quality 2d DnD battlemap, ${params.prompt}, top-down overhead view, tactical grid-ready, detailed terrain, clear paths and obstacles, dramatic lighting with distinct shadows, VTT-compatible, for tabletop RPG`;

    // Negative prompt optimized for battlemap generation
    // const negativePrompt = 'grid, low angle, isometric, oblique, horizon, text, watermark, logo, caption, people, creatures, monsters, blurry, artifacts';
    const negativePrompt = 'grid, gridlines, hex grid, square grid, low angle, isometric, oblique, 3d, 3d models, perspective distortion, fisheye, horizon, text, watermark, logo, caption, people, creatures, monsters, NPCs, blurry, artifacts, fog, mist, cluttered, messy, cartoon, painted style';

    // Map quality setting to diffusion steps
    const baseSteps = params.quality === 'high' ? 45 : params.quality === 'medium' ? 25 : 15;
    const refineSteps = params.quality === 'high' ? 30 : params.quality === 'medium' ? 20 : 10;
    return {
      // ========== STAGE 1: Base Generation ==========
      "1": { // Base Model Checkpoint
        "inputs": {
          "ckpt_name": "dDBattlemapsSDXL10_v10.safetensors"
        },
        "class_type": "CheckpointLoaderSimple"
      },
      "2": { // Base Positive Prompt
        "inputs": {
          "text": enhancedPrompt,
          "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "3": { // Base Negative Prompt
        "inputs": {
          "text": negativePrompt,
          "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "4": { // Base Empty Latent
        "inputs": {
          "width": basePixels,
          "height": basePixels,
          "batch_size": 1
        },
        "class_type": "EmptyLatentImage"
      },
      "5": { // Base KSampler
        "inputs": {
          "seed": Math.floor(Math.random() * 1000000),
          "steps": baseSteps,
          "cfg": 7.5,
          "denoise": 1.0,
          "sampler_name": "dpmpp_2m_sde",
          "scheduler": "karras",
          "model": ["1", 0],
          "positive": ["2", 0],
          "negative": ["3", 0],
          "latent_image": ["4", 0]
        },
        "class_type": "KSampler"
      },
      "9": { // VAE Loader (shared)
        "inputs": {
          "vae_name": "sdxl_vae.safetensors"
        },
        "class_type": "VAELoader"
      },
      "6": { // Base VAE Decode
        "inputs": {
          "samples": ["5", 0],
          "vae": ["9", 0]
        },
        "class_type": "VAEDecode"
      },

      // ========== STAGE 2: Upscale & Refine ==========
      "10": { // Latent Upscale (2x)
        "inputs": {
          "upscale_method": "nearest-exact",
          "width": basePixels * 2,
          "height": basePixels * 2,
          "crop": "disabled",
          "samples": ["5", 0]
        },
        "class_type": "LatentUpscale"
      },
      "11": { // Upscale Model Checkpoint
        "inputs": {
          "ckpt_name": "dDBattlemapsSDXL10_upscaleV10.safetensors"
        },
        "class_type": "CheckpointLoaderSimple"
      },
      "12": { // Upscale Positive Prompt (same as base)
        "inputs": {
          "text": enhancedPrompt,
          "clip": ["11", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "13": { // Upscale Negative Prompt (same as base)
        "inputs": {
          "text": negativePrompt,
          "clip": ["11", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "14": { // Refine KSampler (img2img with lower denoise)
        "inputs": {
          "seed": Math.floor(Math.random() * 1000000),
          "steps": refineSteps,
          "cfg": 7.5,
          "denoise": 0.35, // Lower denoise for img2img refinement
          "sampler_name": "dpmpp_2m_sde",
          "scheduler": "karras",
          "model": ["11", 0],
          "positive": ["12", 0],
          "negative": ["13", 0],
          "latent_image": ["10", 0] // Use upscaled latent
        },
        "class_type": "KSampler"
      },
      "15": { // Final VAE Decode
        "inputs": {
          "samples": ["14", 0],
          "vae": ["9", 0]
        },
        "class_type": "VAEDecode"
      },
      "7": { // Save Final Image
        "inputs": {
          "filename_prefix": "battlemap-upscaled",
          "images": ["15", 0]
        },
        "class_type": "SaveImage"
      }
    };
  }

  /**
   * Build the single-stage ComfyUI workflow (simpler, faster)
   */
  private buildWorkflow(params: RunPodGenerateParams): Record<string, any> {
    // Map size to pixels
    const sizeMap: Record<string, number> = {
      small: 1024,
      medium: 1536,
      large: 2048
    };
    const pixels = sizeMap[params.size] || 1536;

    // Enhanced prompt for D&D Battlemaps SDXL
    const enhancedPrompt = `High-quality 2d DnD battlemap, ${params.prompt}, top-down overhead view, tactical grid-ready, detailed terrain, clear paths and obstacles, dramatic lighting with distinct shadows, VTT-compatible, for tabletop RPG`;

    // Negative prompt optimized for battlemap generation
    const negativePrompt = 'grid, gridlines, hex grid, square grid, low angle, isometric, oblique, 3d, 3d models, perspective distortion, fisheye, horizon, text, watermark, logo, caption, people, creatures, monsters, NPCs, blurry, artifacts, fog, mist, cluttered, messy, cartoon, painted style';

    // Map quality setting to diffusion steps
    const steps = params.quality === 'high' ? 50 : params.quality === 'medium' ? 25 : 10;
    return {
      "1": { // CheckpointLoaderSimple
        "inputs": {
          "ckpt_name": "dDBattlemapsSDXL10_v10.safetensors"
        },
        "class_type": "CheckpointLoaderSimple"
      },
      "2": { // CLIP Text Encode (Positive)
        "inputs": {
          "text": enhancedPrompt,
          "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "3": { // CLIP Text Encode (Negative)
        "inputs": {
          "text": negativePrompt,
          "clip": ["1", 1]
        },
        "class_type": "CLIPTextEncode"
      },
      "4": { // Empty Latent Image
        "inputs": {
          "width": pixels,
          "height": pixels,
          "batch_size": 1
        },
        "class_type": "EmptyLatentImage"
      },
      "5": { // KSampler
        "inputs": {
          "seed": Math.floor(Math.random() * 1000000),
          "steps": steps,
          "cfg": 7.5,
          "denoise": 1.0,
          "sampler_name": "dpmpp_2m_sde",
          "scheduler": "karras",
          "model": ["1", 0],
          "positive": ["2", 0],
          "negative": ["3", 0],
          "latent_image": ["4", 0]
        },
        "class_type": "KSampler"
      },
      "9": { // VAE Loader
        "inputs": {
          "vae_name": "sdxl_vae.safetensors"
        },
        "class_type": "VAELoader"
      },
      "6": { // VAE Decode
        "inputs": {
          "samples": ["5", 0],
          "vae": ["9", 0]
        },
        "class_type": "VAEDecode"
      },
      "7": { // Save Image
        "inputs": {
          "filename_prefix": "battlemap",
          "images": ["6", 0]
        },
        "class_type": "SaveImage"
      }
    };
  }

  /**
   * Submit a job to RunPod serverless
   */
  async generateMap(params: RunPodGenerateParams): Promise<{ success: boolean; jobId?: string; error?: string; estimatedTime?: string }> {
    try {
      console.log(`[${MODULE_ID}] Submitting job to RunPod:`, { endpoint: this.endpointId, params });

      // Choose workflow based on twoStage parameter
      const workflow = params.twoStage
        ? this.buildTwoStageWorkflow(params)
        : this.buildWorkflow(params);

      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          input: {
            workflow: workflow
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${MODULE_ID}] RunPod API error:`, { status: response.status, error: errorText });
        throw new Error(`RunPod API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`[${MODULE_ID}] RunPod job submitted:`, data);

      const estimatedTime = params.twoStage
        ? '60-180 seconds (two-stage: base + upscale)'
        : '30-90 seconds (single-stage)';

      return {
        success: true,
        jobId: data.id,
        estimatedTime
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to submit job to RunPod:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check the status of a RunPod job
   */
  async checkStatus(jobId: string): Promise<{ success: boolean; job?: any; error?: string }> {
    try {
      console.log(`[${MODULE_ID}] Checking RunPod job status:`, { jobId });

      const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${MODULE_ID}] RunPod status check error:`, { status: response.status, error: errorText });
        throw new Error(`RunPod status check error: ${response.status}`);
      }

      const data: RunPodJobResponse = await response.json();
      console.log(`[${MODULE_ID}] RunPod job status:`, data);

      // Map RunPod status to our internal status
      let internalStatus: string;
      let progressPercent = 0;
      let currentStage = 'Unknown';

      switch (data.status) {
        case 'IN_QUEUE':
          internalStatus = 'queued';
          progressPercent = 0;
          currentStage = 'Queued';
          break;
        case 'IN_PROGRESS':
          internalStatus = 'generating';
          progressPercent = 50; // Estimate since RunPod doesn't provide fine-grained progress
          currentStage = 'Generating battlemap...';
          break;
        case 'COMPLETED':
          internalStatus = 'complete';
          progressPercent = 100;
          currentStage = 'Complete';
          break;
        case 'FAILED':
        case 'TIMED_OUT':
          internalStatus = 'failed';
          progressPercent = 0;
          currentStage = 'Failed';
          break;
        case 'CANCELLED':
          internalStatus = 'failed';
          progressPercent = 0;
          currentStage = 'Cancelled';
          break;
        default:
          internalStatus = 'queued';
          progressPercent = 0;
          currentStage = 'Unknown';
      }

      return {
        success: true,
        job: {
          id: jobId,
          status: internalStatus,
          progress_percent: progressPercent,
          current_stage: currentStage,
          result: data.output,
          error: data.error
        }
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to check RunPod job status:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cancel a RunPod job
   */
  async cancelJob(jobId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`[${MODULE_ID}] Cancelling RunPod job:`, { jobId });

      const response = await fetch(`${this.baseUrl}/cancel/${jobId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${MODULE_ID}] RunPod cancel error:`, { status: response.status, error: errorText });
        throw new Error(`RunPod cancel error: ${response.status}`);
      }

      console.log(`[${MODULE_ID}] RunPod job cancelled successfully:`, { jobId });

      return {
        success: true,
        message: 'Job cancelled successfully'
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to cancel RunPod job:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Download an image from RunPod output
   * RunPod typically returns base64 encoded images or URLs
   */
  async downloadImage(imageData: any): Promise<string> {
    console.log(`[${MODULE_ID}] Processing image data, type:`, typeof imageData);
    console.log(`[${MODULE_ID}] Image data sample:`, JSON.stringify(imageData).substring(0, 200));

    // Handle null/undefined
    if (!imageData) {
      throw new Error('Image data is null or undefined');
    }

    // If it's an object with image data, extract it
    if (typeof imageData === 'object' && !Array.isArray(imageData)) {
      // Check for common object structures
      if (imageData.url) {
        imageData = imageData.url;
      } else if (imageData.base64) {
        imageData = imageData.base64;
      } else if (imageData.data) {
        imageData = imageData.data;
      } else {
        console.error(`[${MODULE_ID}] Unknown image object structure:`, imageData);
        throw new Error('Unknown image data object structure');
      }
    }

    // If it's an array, try to convert to base64
    if (Array.isArray(imageData)) {
      console.log(`[${MODULE_ID}] Converting array to base64`);
      const uint8Array = new Uint8Array(imageData);
      const blob = new Blob([uint8Array], { type: 'image/png' });
      return await this.blobToBase64(blob);
    }

    // Now it should be a string
    if (typeof imageData !== 'string') {
      throw new Error(`Unexpected image data type: ${typeof imageData}`);
    }

    // If it's already base64 with data URI prefix, return without prefix
    if (imageData.startsWith('data:image')) {
      console.log(`[${MODULE_ID}] Removing data URI prefix from base64`);
      return imageData.split(',')[1];
    }

    // If it's a URL, fetch and convert to base64
    if (imageData.startsWith('http')) {
      console.log(`[${MODULE_ID}] Fetching image from URL:`, imageData.substring(0, 50));
      try {
        const response = await fetch(imageData);
        const blob = await response.blob();
        return await this.blobToBase64(blob);
      } catch (error) {
        console.error(`[${MODULE_ID}] Failed to download image from URL:`, error);
        throw error;
      }
    }

    // Assume it's already base64 without prefix
    console.log(`[${MODULE_ID}] Assuming raw base64 data`);
    return imageData;
  }

  /**
   * Convert blob to base64
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove the data:image/xxx;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
