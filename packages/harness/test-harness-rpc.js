const WebSocket = require('ws');
const assert = require('assert');

console.log("=== Testing Harness JSON-RPC APIs ===");

const ws = new WebSocket('ws://localhost:3700');

let callId = 1;
const pendingCalls = new Map();

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = callId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    pendingCalls.set(id, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
}

ws.on('open', async () => {
  console.log("Connected to Harness Daemon. Starting RPC validations...");
  try {
    // 1. Test Mining Controls
    console.log("Testing mining toggle...");
    const minRes = await call('harness.mining.toggleMiner', { substrate: 'fractal', active: true });
    assert.strictEqual(minRes.success, true);
    assert.strictEqual(minRes.substrate, 'fractal');
    assert.strictEqual(minRes.active, true);
    console.log("✔ Mining toggle OK");

    // 2. Test Media Scene Switching
    console.log("Testing media scene switch...");
    const medRes = await call('harness.media.setActiveScene', { sceneName: 'LiveBroadcast' });
    assert.strictEqual(medRes.success, true);
    assert.strictEqual(medRes.activeScene, 'LiveBroadcast');
    console.log("✔ Media scene switch OK");

    // 3. Test DAW Playback Controls
    console.log("Testing DAW playback control...");
    const dawRes = await call('harness.daw.setPlaybackState', { playing: true, bpm: 128 });
    assert.strictEqual(dawRes.success, true);
    assert.strictEqual(dawRes.playing, true);
    assert.strictEqual(dawRes.bpm, 128);
    console.log("✔ DAW playback control OK");

    // 4. Test BustaBolt Betting Controls
    console.log("Testing BustaBolt placing bet...");
    const betRes = await call('harness.bustabolt.placeBet', { amountWei: '5000000000000000', autoCashout: 1.5 });
    assert.strictEqual(betRes.success, true);
    assert.strictEqual(betRes.amountWei, '5000000000000000');
    assert.strictEqual(betRes.autoCashout, 1.5);
    console.log("✔ BustaBolt place bet OK");

    // 5. Test Chainvas Creator Controls
    console.log("Testing Chainvas layer creation...");
    const layRes = await call('harness.chainvas.createLayer', { layerName: 'OverlayLayer' });
    assert.strictEqual(layRes.success, true);
    assert.strictEqual(layRes.layerName, 'OverlayLayer');
    console.log("✔ Chainvas layer creation OK");

    console.log("Testing Chainvas asset minting...");
    const mintRes = await call('harness.chainvas.mintAsset', { projectId: 'proj-789', metadata: { name: 'BOLT Album Art' } });
    assert.strictEqual(mintRes.success, true);
    assert.strictEqual(mintRes.projectId, 'proj-789');
    assert.ok(mintRes.txHash, "Mint response missing txHash");
    console.log("✔ Chainvas asset minting OK");

    console.log("All RPC validations PASSED.");
    ws.close();
    process.exit(0);
  } catch (err) {
    console.error("Test failed with error:", err);
    ws.close();
    process.exit(1);
  }
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.id !== undefined && msg.id !== null) {
      const pending = pendingCalls.get(msg.id);
      if (pending) {
        if (msg.error) pending.reject(msg.error);
        else pending.resolve(msg.result);
        pendingCalls.delete(msg.id);
      }
    }
  } catch (e) {
    // Non-JSON-RPC telemetry frames ignored
  }
});

ws.on('error', (err) => {
  console.error("WebSocket Error:", err);
  process.exit(1);
});
