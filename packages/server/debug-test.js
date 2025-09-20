const test = async () => {
  const response = await fetch('http://localhost:3001/api/dev/sessions');
  await response.json();
  
  const deploymentsResponse = await fetch('http://localhost:3001/api/deployments');
  await deploymentsResponse.json();
  
  const healthResponse = await fetch('http://localhost:3001/api/system/health');
  const healthData = await healthResponse.json();
  
  console.log('activatedServices:', healthData.data.activatedServices);
  console.log('includes deployments?', healthData.data.activatedServices.includes('deployments'));
  console.log('includes dev-sessions?', healthData.data.activatedServices.includes('dev-sessions'));
};

// Start server and run test
import { spawn } from 'child_process';

const server = spawn('bun', ['run', 'dev'], {
  cwd: '/workspaces/hola/packages/server',
  env: { ...process.env, HOLA_ENABLE_DEV_API: 'true', HOLA_USE_REAL_DOCKER: 'false' }
});

setTimeout(async () => {
  try {
    await test();
  } catch (e) {
    console.error('Error:', e.message);
  }
  server.kill();
}, 2000);
