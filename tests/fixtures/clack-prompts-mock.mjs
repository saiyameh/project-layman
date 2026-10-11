import fs from 'node:fs';
import os from 'node:os';

if (process.env.LAYMAN_TEST_HOME) os.homedir = () => process.env.LAYMAN_TEST_HOME;

if (process.env.LAYMAN_TEST_FETCH_LOG) {
  globalThis.fetch = async (url) => {
    fs.appendFileSync(process.env.LAYMAN_TEST_FETCH_LOG, `${url}\n`);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

const replies = JSON.parse(process.env.LAYMAN_TEST_PROMPTS || '[]');
const next = () => replies.shift();

export const select = async () => next();
export const multiselect = async () => next();
export const text = async () => next();
export const password = async () => next();
export const confirm = async () => next();
export const isCancel = () => false;
export const intro = () => {};
export const outro = () => {};
export const cancel = () => {};
export const log = { info: () => {}, success: () => {}, warn: () => {}, error: () => {} };
export const spinner = () => ({ start: () => {}, stop: () => {}, message: () => {} });
