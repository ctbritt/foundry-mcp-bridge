# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Foundry MCP Bridge connects Foundry VTT to AI models through the Model Context Protocol (MCP). It enables AI-powered actor creation, intelligent compendium search, campaign analysis, and interactive dice roll coordination. The module supports Claude, local LLMs, and future AI models with GM-only security.

**Key Architecture**: This is a Foundry VTT module (browser-side) that communicates with an MCP server (Node.js backend) via WebSocket or WebRTC connections.

## Development Commands

```bash
# Build the module (TypeScript → JavaScript)
npm run build

# Watch mode for development
npm run dev

# Type checking only (no output)
npm run typecheck

# Lint code
npm run lint

# Lint and auto-fix
npm run lint:fix

# Clean build artifacts
npm run clean
```

## High-Level Architecture

### Connection Architecture (Dual-Stack)

The module supports two connection types between Foundry (browser) and the MCP server:

1. **WebSocket** (HTTP/localhost): Direct WebSocket connection for local development
2. **WebRTC** (HTTPS): Peer-to-peer encrypted channel using HTTP POST signaling, enabling HTTPS Foundry instances to connect to localhost MCP servers without SSL certificates

Connection type is auto-detected based on page protocol (`https:` → WebRTC, `http:` → WebSocket) or manually configured via settings.

### Core Component Flow

```
┌─────────────────────────────────────────────────────────┐
│ main.ts (FoundryMCPBridge)                              │
│ - Module lifecycle management                           │
│ - Foundry hooks registration                            │
│ - Heartbeat monitoring                                  │
│ - GM-only access control                                │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ settings │  │ queries  │  │ socket-bridge│
│   .ts    │  │   .ts    │  │     .ts      │
└──────────┘  └────┬─────┘  └──────┬───────┘
                   │                │
                   │         ┌──────┴────────┐
                   │         │               │
                   │         ▼               ▼
                   │  ┌────────────┐  ┌────────────┐
                   │  │  webrtc-   │  │ WebSocket  │
                   │  │ connection │  │            │
                   │  └────────────┘  └────────────┘
                   │
                   ▼
        ┌──────────────────┐
        │  data-access.ts  │
        │ - Foundry API    │
        │ - Actor/Scene    │
        │ - Compendium     │
        │ - Journal CRUD   │
        └──────────────────┘
```

### Key Architectural Decisions

1. **Security-First Design**: All MCP operations require GM access. Non-GM users get silent denials (no error messages) to prevent information leakage.

2. **Query Handler Registration**: MCP tools are exposed via `CONFIG.queries` registry. Each tool maps to a handler in `queries.ts` which delegates to `data-access.ts`.

3. **Hybrid Map Generation**: Map generation uses `ComfyUIManager` to communicate with backend services (local ComfyUI or RunPod cloud) via WebSocket, then receives completed scenes via the main socket bridge.

4. **Enhanced Creature Index**: Pre-computed creature statistics stored in world folder (`enhanced-creature-index.json`) enable instant filtering by CR, type, and abilities without loading all compendiums.

5. **Interactive Roll System**: GM can request player rolls via chat buttons. Roll state persists in ChatMessage flags, synced across clients via Foundry's native message update mechanism.

## Module Entry Points

- **src/main.ts**: Module entry point, hooks registration, lifecycle management
- **src/socket-bridge.ts**: Connection manager (WebSocket/WebRTC selection and handling)
- **src/queries.ts**: MCP query handler registry and delegation
- **src/data-access.ts**: Foundry API operations and game state access
- **src/settings.ts**: Module settings registration and UI

## Important Files

### Core Infrastructure
- **src/constants.ts**: Shared constants, connection states, error messages
- **src/permissions.ts**: Permission validation utilities
- **src/transaction-manager.ts**: Transaction coordination for multi-step operations

### Specialized Features
- **src/campaign-hooks.ts**: Interactive campaign dashboard system
- **src/comfyui-manager.ts**: Map generation service communication
- **src/runpod-client.ts**: Cloud GPU provider integration for map generation
- **src/webrtc-connection.ts**: WebRTC P2P connection implementation

### Configuration
- **module.json**: Foundry module manifest
- **tsconfig.json**: TypeScript compiler configuration
- **types/foundry-extensions.d.ts**: TypeScript definitions for Foundry globals

## Connection Flow

1. User enables module in settings
2. `FoundryMCPBridge.start()` creates `SocketBridge` with config
3. `SocketBridge.connect()` determines connection type (auto/explicit)
4. For WebRTC: Creates RTCPeerConnection → DataChannel → sends offer via HTTP POST to port 31416 → receives answer → establishes P2P channel
5. For WebSocket: Direct WebSocket connection to configured port
6. Message handler receives `mcp-query` messages, looks up handler in `CONFIG.queries`, executes, and sends `mcp-response`

## MCP Query Handler Pattern

All MCP tools follow this pattern:

```typescript
// In queries.ts
private async handleToolName(data: { params }): Promise<any> {
  // 1. GM access validation
  const gmCheck = this.validateGMAccess();
  if (!gmCheck.allowed) {
    return { error: 'Access denied', success: false };
  }

  // 2. Validate Foundry state
  this.dataAccess.validateFoundryState();

  // 3. Parameter validation
  if (!data.requiredParam) {
    throw new Error('requiredParam is required');
  }

  // 4. Delegate to data-access
  return await this.dataAccess.toolOperation(data);
}
```

## Working with Compendiums

The module uses a two-tier compendium search system:

1. **Enhanced Creature Index**: Fast, pre-computed index for creature filtering by CR, type, size, etc. Stored in `worlds/{worldId}/enhanced-creature-index.json`.
2. **Direct Compendium Search**: Full-text search across all compendium types when enhanced index is disabled or for non-creature searches.

When modifying creature search logic, check both `data-access.ts::searchCompendium()` and `data-access.ts::listCreaturesByCriteria()`.

## Map Generation Architecture

Map generation uses a hybrid approach:

1. GM requests map via MCP tool → `queries.ts::handleGenerateMap()`
2. Request forwarded to `ComfyUIManager` which maintains separate WebSocket to backend
3. Backend processes via ComfyUI (local or RunPod cloud)
4. Progress updates sent via main socket bridge (`map-generation-progress` messages)
5. Completion sent via `job-completed` message with scene data
6. `socket-bridge.ts::handleJobCompleted()` creates Foundry scene and activates it

## Security Model

**ALL MCP operations are GM-only**. The security model is implemented at multiple layers:

1. **Module Initialization**: `onReady()` returns early for non-GM users
2. **Query Handlers**: Every handler calls `validateGMAccess()` first
3. **Silent Denials**: Non-GM users receive `{ error: 'Access denied' }` with no additional information

## Foundry Version Compatibility

This module targets **Foundry VTT v13**. Key compatibility notes:

- Uses `renderChatMessageHTML` hook (v13) instead of deprecated `renderChatMessage`
- Uses modern FilePicker API: `foundry.applications.apps.FilePicker.implementation` with fallback
- Scene image requires workaround: Set `img` and `background.src` separately due to v13 bug

## Testing the Module

1. Start the MCP server (see main repository README)
2. Open Foundry VTT and enable the module
3. Check browser console for connection status: `[foundry-mcp-bridge] Bridge started successfully`
4. Test using the debug helpers in browser console:
   ```javascript
   foundryMCPDebug.getStatus()  // Check connection status
   foundryMCPDebug.restart()    // Restart connection
   ```

## Common Patterns

### Adding a New MCP Tool

1. Add handler registration in `queries.ts::registerHandlers()`
2. Implement handler method following the GM validation pattern
3. Add corresponding method in `data-access.ts` if accessing Foundry data
4. Update MCP server with new tool definition

### Modifying Connection Logic

Connection management is centralized in `socket-bridge.ts`. WebRTC-specific logic is in `webrtc-connection.ts`. Always test both connection types when making changes.

### Adding Module Settings

Settings are registered in `settings.ts::registerSettings()`. Complex settings with submenus extend `FormApplication` inline within the registration.

## Game System Support

The module is designed to be system-agnostic but includes enhanced support for:

- **D&D 5e**: CR-based creature filtering, spell detection, legendary actions
- **Pathfinder 2e**: Level-based filtering, trait system, rarity

System-specific logic is isolated in `data-access.ts` creature index methods.
