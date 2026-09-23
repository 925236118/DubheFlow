// DeepSeek 流式聊天独立测试脚本
// 直接使用项目中的 OpenAIClient,验证 SSE 流式解析、重试、DeepSeek API 兼容性
// 用法: set DEEPSEEK_API_KEY=sk-xxxx && node --experimental-strip-types scripts/test-deepseek.ts

import { OpenAIClient } from '../electron/main/providers/openai-client'

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey || !apiKey.startsWith('sk-')) {
  console.error('✗ 请先设置 DEEPSEEK_API_KEY 环境变量(以 sk- 开头)')
  process.exit(1)
}

const client = new OpenAIClient({
  baseURL: 'https://api.deepseek.com',
  apiKey,
  defaultModel: 'deepseek-chat',
  timeoutMs: 60_000,
  rpm: 30
})

const prompt = process.argv[2] ?? '用一句话介绍你自己,再说一个 GDScript 的 Hello World。'

console.log('━' .repeat(60))
console.log(`模型: deepseek-chat`)
console.log(`提示: ${prompt}`)
console.log('━' .repeat(60))
console.log('')

let full = ''
let usage = null
const start = Date.now()

try {
  for await (const chunk of client.chat({
    capability: 'coding',
    messages: [
      { role: 'system', content: '你是天枢工作站的 AI 助手,简洁回答。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    maxTokens: 512,
    stream: true
  })) {
    if (chunk.delta) {
      process.stdout.write(chunk.delta)
      full += chunk.delta
    }
    if (chunk.usage) {
      usage = chunk.usage
    }
    if (chunk.finishReason) {
      console.log(`\n  [finish: ${chunk.finishReason}]`)
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n' + '━'.repeat(60))
  console.log(`✓ 完成 · 耗时 ${elapsed}s · 字符数 ${full.length}`)
  if (usage) {
    console.log(
      `  tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`
    )
  }
} catch (err) {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.error(`\n✗ 失败 · 耗时 ${elapsed}s`)
  if (err && typeof err === 'object' && 'status' in err) {
    console.error(`  HTTP ${err.status}: ${err.body ?? err.message}`)
  } else {
    console.error(' ', err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
}
