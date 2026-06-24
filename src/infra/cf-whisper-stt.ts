// Cloudflare Workers AI Whisper 语音转文字（spec 008，ADR-0007）。

import { transcribe } from '../stt';
import type { ITTSProvider } from '../ports';
import type { Env } from '../types';

export class CFWhisperSTT implements ITTSProvider {
  private env: Pick<Env, 'AI'>;

  constructor(env: Pick<Env, 'AI'>) {
    this.env = env;
  }

  async transcribe(audioBytes: Uint8Array): Promise<string> {
    // cast needed: transcribe expects full Env but only touches AI; safe
    return transcribe(audioBytes, this.env as Env);
  }
}
