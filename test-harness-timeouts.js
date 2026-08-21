const { fork } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

async function runTest() {
  console.log('[Test Timeouts] Starting harness daemon...');
  
  const daemonPath = path.join(__dirname, 'packages/harness/dist/index.js');
  const daemon = fork(daemonPath, { silent: true });

  daemon.stdout.on('data', (data) => {
    console.log(`[Daemon Out] ${data.toString().trim()}`);
  });

  daemon.stderr.on('data', (data) => {
    console.error(`[Daemon Err] ${data.toString().trim()}`);
  });

  // Wait a moment for daemon to start listening on port 3700
  await new Promise(resolve => setTimeout(resolve, 2000));

  let dummySubsystemWs;
  let clientWs;
  let success = false;

  try {
    // Create a dummy WebSocket client that registers as the 'daw' subsystem
    dummySubsystemWs = new WebSocket('ws://localhost:3700');
    
    await new Promise((resolve, reject) => {
      dummySubsystemWs.on('open', resolve);
      dummySubsystemWs.on('error', reject);
    });

    // Register subsystem
    dummySubsystemWs.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'harness.registerSubsystem',
      params: { name: 'daw' }
    }));

    // Wait for registration confirmation
    await new Promise((resolve) => {
      dummySubsystemWs.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.result && msg.result.registered) {
          console.log('[Test Timeouts] Dummy subsystem registered successfully.');
          resolve();
        }
      });
    });

    // Connect a Harness Client to issue the RPC request
    clientWs = new WebSocket('ws://localhost:3700');
    await new Promise((resolve, reject) => {
      clientWs.on('open', resolve);
      clientWs.on('error', reject);
    });

    console.log('[Test Timeouts] Client connected. Sending RPC request...');
    const startTime = Date.now();

    // Call harness.daw.setPlaybackState which routes to 'daw'
    clientWs.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'harness.daw.setPlaybackState',
      params: { playing: true, bpm: 120 }
    }));

    // Wait for response from the daemon
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test failed: RPC call did not return a response/timeout from the daemon'));
      }, 6000); // Wait up to 6 seconds

      clientWs.on('message', (data) => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
      });
    });

    const duration = Date.now() - startTime;
    console.log(`[Test Timeouts] Received response in ${duration}ms:`, response);

    // Assertions
    if (response.error && response.error.code === -32603 && response.error.message.includes('timed out after 4000ms')) {
      console.log('[Test Timeouts] SUCCESS: Correctly received subsystem timeout error!');
      success = true;
    } else {
      console.error('[Test Timeouts] FAILURE: Did not receive the expected timeout error.', response);
    }
  } catch (err) {
    console.error('[Test Timeouts] Error occurred during test:', err);
  } finally {
    // Cleanup
    if (dummySubsystemWs) dummySubsystemWs.close();
    if (clientWs) clientWs.close();
    daemon.kill();
    console.log('[Test Timeouts] Harness daemon stopped.');
    process.exit(success ? 0 : 1);
  }
}

runTest();
