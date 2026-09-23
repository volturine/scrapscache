/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// Downloads, shader compilation, and token generation all run here, off the UI thread.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => handler.onmessage(event);
