import { runTask } from './expedienteTasks.js';

self.onmessage = ({ data }) => {
  const { id, op, payload } = data;
  try {
    self.postMessage({ id, result: runTask(op, payload) });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
