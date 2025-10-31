# Foundry VTT MCP Bridge Module

This is the **Foundry VTT module component** of the [Foundry VTT MCP Bridge](https://github.com/adambdooley/foundry-vtt-mcp) project by [Adam Dooley](https://github.com/adambdooley). This module runs inside Foundry VTT and communicates with the MCP server to enable AI-powered campaign management through Claude Desktop.

> **Note**: This repository contains only the Foundry module. For the complete package including the MCP server, installers, and ComfyUI integration, see the [main repository](https://github.com/adambdooley/foundry-vtt-mcp).

## Why this module?

Because I have a slow Mac at home and the local ComfyUI was taking too long to generate maps. So I set up my own RunPod serverless instance, downloaded the Safe Tensor models and other files from [civit.ai](https://civit.ai), and vibe-coded the addition of [RunPod](https://runpod.io). So far, it's working really well for me. 

The files you'll need for the whole two-stage process are: 
- [dDBattlemapsSDXL10_v10.safetensors](https://civitai.com/api/download/models/1204482?type=Model&format=SafeTensor&size=full&fp=bf16)
- [dDBattlemapsSDXL10_v10.yaml](https://civitai.com/api/download/models/1204482?type=Config)
- [dDBattlemapsSDXL10_upscaleV10.safetensors](https://civitai.com/api/download/models/1521765?type=Model&format=SafeTensor&size=full&fp=bf16) (optional, but they look nicer.)
- [dDBattlemapsSDXL10_upscaleV10.yaml](https://civitai.com/api/download/models/1521765?type=Config)

On your RunPod setup, create a network volume of 30GB or so and upload the files to /workspace with the following structure:
```
/workspace/
   checkpoints/ < safetensor files go here
   configs/ < config files go here
```
For more detailed instructions, see the [RunPod how-to](url).

## Fork Enhancements

This fork adds:
- **Two-Stage RunPod Workflow**: Enhanced map generation using base model + upscale refinement for higher quality battlemaps
- **Improved Prompts**: Better negative prompts and enhanced prompt templates for battlemap generation
- **Configurable Workflow**: Toggle between single-stage (faster) and two-stage (higher quality) via Foundry settings
- **RunPod Integration**: Direct support for RunPod serverless GPU endpoints

## Overview

The Foundry MCP Bridge module provides secure, GM-only access to your Foundry VTT game data for AI interactions:

- **Quest Creation**: Create quests from prompts incorporating your world and journals
- **Character Management**: Query character stats, abilities, and information
- **Compendium Search**: Find items, spells, and creatures using natural language
- **Content Creation**: Generate actors, NPCs, and quest journals from prompts
- **Scene Information**: Access current scene data and world details
- **Dice Coordination**: Interactive roll requests with player targeting
- **Campaign Management**: Multi-part quest and campaign tracking
- **Map Generation**: AI-powered battlemap creation with RunPod or local ComfyUI support

**Supported Systems**: D&D 5e, Pathfinder 2e (core tools are system-agnostic)

## Credits

Original project by [Adam Dooley](https://github.com/adambdooley) - [Support on Patreon](https://www.patreon.com/c/Adambdooley)

This project was built with the assistance of Claude Code.

## Installation

> **Important**: This module requires the [MCP server](https://github.com/adambdooley/foundry-vtt-mcp) to be installed and running. For the easiest installation experience, use the installers from the [main repository](https://github.com/adambdooley/foundry-vtt-mcp/releases).

### Option 1: Via Manifest URL (Recommended)

1. Open Foundry VTT v13 or v14
2. Navigate to **Add-on Modules** → **Install Module**
3. Paste this manifest URL at the bottom:
   ```
   https://github.com/ctbritt/foundry-mcp-bridge/releases/latest/download/module.json
   ```
4. Click **Install**
5. Enable "Foundry MCP Bridge" in your Module Management

### Option 2: Manual Installation from Source

```bash
# Clone this repository
git clone https://github.com/ctbritt/foundry-mcp-bridge.git
cd foundry-mcp-bridge

# Install dependencies and build
npm install
npm run build

# Copy to your Foundry modules directory
# Linux/Mac:
cp -r . ~/foundryuserdata/Data/modules/foundry-mcp-bridge/

# Windows:
# Copy the entire directory to %localappdata%\FoundryVTT\Data\modules\foundry-mcp-bridge\
```

### Getting Started

1. Install and configure the [MCP server](https://github.com/adambdooley/foundry-vtt-mcp) (see main repo for instructions)
2. Start Foundry VTT and enable this module
3. Open Claude Desktop (which should start the MCP server automatically)
4. Chat with Claude about your currently loaded Foundry world!

## Example Usage

Once connected, ask Claude Desktop:

- *"Show me my character Clark's stats"*
- *"Find all CR 12 humanoid creatures for an encounter"*
- *"Create a quest about investigating missing villagers"*
- *"Roll a stealth check for Tulkas"*
- *"What's in the current Foundry scene?"*
- *"Create me a small map of a Riverside Cottage in Foundry"*

## Module Features

This module provides the Foundry VTT side of the bridge:

- **Secure Data Access**: GM-only query handlers for all MCP tools
- **Character Management**: Expose character stats, abilities, and inventory to AI
- **Enhanced Compendium Search**: Pre-computed creature index for instant filtering
- **Content Creation**: Support for AI-generated actors, NPCs, and quest journals
- **Campaign Tracking**: Dashboard generation and quest progress monitoring
- **Interactive Dice System**: Process roll requests and coordinate with players
- **Actor Ownership**: Permission management for AI-created content
- **Map Generation**:
  - RunPod serverless GPU integration
  - Two-stage workflow (base + upscale) for higher quality
  - Local ComfyUI support via MCP server
- **Connection Types**:
  - WebSocket for local networks
  - WebRTC for remote/HTTPS connections
- **GM-Only Security**: All MCP operations require Game Master privileges

## Two-Stage Map Generation Workflow

This fork includes an enhanced two-stage workflow for RunPod map generation:

### How It Works

1. **Stage 1 - Base Generation**: Creates image at lower resolution using `dDBattlemapsSDXL10_v10.safetensors`
2. **Stage 2 - Upscale & Refine**: Upscales 2x and refines details using `dDBattlemapsSDXL10_upscaleV10.safetensors`

### Configuration

Enable via Foundry module settings:
- **Use Two-Stage Workflow (RunPod)**: Toggle between single-stage (faster) and two-stage (higher quality)
- **Generation Quality**:
  - Low: 10-15 steps (fast, good for testing)
  - Medium: 20-25 steps (balanced)
  - High: 45-50 steps (best quality, slower)

### Requirements

For two-stage workflow on RunPod, you need both models:
- `dDBattlemapsSDXL10_v10.safetensors` (base model)
- `dDBattlemapsSDXL10_upscaleV10.safetensors` (upscale model)
- `sdxl_vae.safetensors` (VAE)

### Performance

- **Single-stage**: 30-90 seconds, generates directly at target resolution
- **Two-stage**: 60-180 seconds, better quality through base+upscale approach

## Key Settings

The module includes several configuration options:

- **Connection Settings**: Auto-detect or force WebSocket/WebRTC
- **Security**: Enable/disable write operations, max actors per request
- **Enhanced Creature Index**: Pre-computed metadata for instant creature filtering
- **Map Generation**: Service type (local/RunPod), quality, workflow type
- **Auto-reconnect**: Automatic reconnection on disconnect

For detailed settings information, see the module's configuration menus in Foundry VTT.

## Architecture

This module is one component of the larger MCP Bridge system:

```
Claude Desktop
      ↓
  MCP Protocol
      ↓
  MCP Server (Node.js) ←→ ComfyUI/RunPod
      ↓
  WebSocket/WebRTC
      ↓
  [This Module] ← Running inside Foundry VTT
      ↓
  Foundry VTT Game Data
```

**This Module's Role**:
- Receives MCP queries via WebSocket/WebRTC from the MCP server
- Processes queries using Foundry's game data APIs
- Returns results to the MCP server for Claude Desktop
- Manages map generation requests to RunPod or local ComfyUI
- Enforces GM-only security at the Foundry level

## Security & Permissions

- **GM-Only Access**: All MCP operations restricted to Game Master users
- **Configurable Permissions**: Optional read-only mode to prevent modifications
- **Rate Limiting**: Max actors per request to prevent abuse
- **No External APIs**: Works with your existing Claude Desktop subscription

## System Requirements

- **Foundry VTT**: Version 13 or 14
- **MCP Server**: Installed and configured (see [main repository](https://github.com/adambdooley/foundry-vtt-mcp))
- **For Map Generation**:
  - RunPod account with serverless endpoint, OR
  - Local ComfyUI installation with 8GB+ VRAM GPU

## Development

This is a TypeScript project. To build from source:

```bash
npm install
npm run build      # Compile TypeScript
npm run dev        # Watch mode for development
npm run typecheck  # Type check without building
```

## Support & Links

- **Original Project**: [Foundry VTT MCP Bridge](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley
- **Support Adam**: [Patreon](https://www.patreon.com/c/Adambdooley)
- **YouTube**: [Tutorials and updates](https://www.youtube.com/channel/UCVrSC-FzuAk5AgvfboJj0WA)
- **Fork Issues**: [GitHub Issues](https://github.com/ctbritt/foundry-mcp-bridge/issues)
- **License**: MIT License (see LICENSE file)
