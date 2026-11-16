#!/usr/bin/env node
'use strict';
// Starts the GUI Hub MCP server. Run by AI clients (Claude Desktop, Cursor, VS Code, ...) as:
//   command: <GUI Hub executable>, args: [<this file>], env: { ELECTRON_RUN_AS_NODE: "1" }
// or with plain Node: node mcp-entry.js. Shares license, trials and tool cache with the GUI.
const { setup } = require('./server-setup');

const { server } = setup();
server.start();
