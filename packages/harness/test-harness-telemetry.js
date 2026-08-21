const WebSocket = require('ws');
const assert = require('assert');

console.log("=== Testing Harness Telemetry aggregation ===");

const ws = new WebSocket('ws://localhost:3700');

let messageReceived = false;

ws.on('open', () => {
  console.log("Connected to Harness Daemon on port 3700");
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log("Received payload type:", msg.type);
    
    if (msg.type === 'TELEMETRY_UPDATE') {
      const state = msg.state;
      
      console.log("Validating state structure...");
      assert.ok(state.mining, "State missing 'mining' property");
      assert.ok(state.mining.fractal, "State missing 'mining.fractal'");
      assert.ok(state.media, "State missing 'media'");
      assert.ok(state.daw, "State missing 'daw'");
      assert.ok(state.bustabolt, "State missing 'bustabolt'");
      assert.ok(state.b3js, "State missing 'b3js'");
      assert.ok(state.chainvas, "State missing 'chainvas'");

      console.log(`- Mining (Fractal hashrate): ${state.mining.fractal.hashrate} H/s`);
      console.log(`- Media (currentScene): ${state.media.currentScene}`);
      console.log(`- DAW (playing state): ${state.daw.playing}`);
      console.log(`- BustaBolt (betting multiplier): ${state.bustabolt.multiplier}x`);
      console.log(`- B3JS (FPS): ${state.b3js.fps}`);
      console.log(`- Chainvas (active users): ${state.chainvas.activeUsers} (doc: ${state.chainvas.documentType})`);
      
      messageReceived = true;
      ws.close();
    }
  } catch (err) {
    console.error("Test failed with error:", err.message);
    process.exit(1);
  }
});

ws.on('close', () => {
  if (messageReceived) {
    console.log("Telemetry validation PASSED.");
    process.exit(0);
  } else {
    console.error("Test FAILED: Connection closed without receiving TELEMETRY_UPDATE");
    process.exit(1);
  }
});

setTimeout(() => {
  if (!messageReceived) {
    console.error("Test FAILED: Timed out waiting for telemetry broadcast");
    ws.close();
    process.exit(1);
  }
}, 8000);
