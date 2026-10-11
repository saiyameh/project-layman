import os from 'node:os';

os.homedir = () => process.env.LAYMAN_TEST_HOME;
await import('../../dist/index.js');
