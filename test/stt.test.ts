import { describe, it, expect, vi } from 'vitest';
import { transcribe, toBase64 } from '../src/stt';
import type { Env } from '../src/types';

describe('toBase64', () => {
  it('encodes bytes to base64', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');   // "hi"
    expect(toBase64(new Uint8Array([]))).toBe('');
  });

  it('handles large buffers without stack overflow', () => {
    const big = new Uint8Array(100_000).fill(65);   // 'A'
    const out = toBase64(big);
    expect(out.length).toBeGreaterThan(0);
    expect(atob(out).length).toBe(100_000);
  });
});

describe('transcribe (Workers AI Whisper)', () => {
  function envWith(run: ReturnType<typeof vi.fn>): Env {
    return { AI: { run } } as unknown as Env;
  }

  it('calls Whisper with zh transcribe params and returns text', async () => {
    const run = vi.fn().mockResolvedValue({ text: '加了10升花98里程12580' });
    const out = await transcribe(new Uint8Array([1, 2, 3]), envWith(run));

    expect(out).toBe('加了10升花98里程12580');
    expect(run).toHaveBeenCalledWith(
      '@cf/openai/whisper-large-v3-turbo',
      expect.objectContaining({ task: 'transcribe', language: 'zh' })
    );
    // audio 应是 base64 字符串
    const passed = run.mock.calls[0][1] as { audio: unknown };
    expect(typeof passed.audio).toBe('string');
  });

  it('trims whitespace and returns empty for blank result', async () => {
    expect(await transcribe(new Uint8Array([1]), envWith(vi.fn().mockResolvedValue({ text: '  你好  ' })))).toBe('你好');
    expect(await transcribe(new Uint8Array([1]), envWith(vi.fn().mockResolvedValue({ text: '   ' })))).toBe('');
    expect(await transcribe(new Uint8Array([1]), envWith(vi.fn().mockResolvedValue({})))).toBe('');
  });
});
