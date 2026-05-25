import "dotenv/config";

const TESTS = [
  { name: "GLM-5.1 (技术总监)", model: "glm-5.1", key: "GLM_API_KEY", url: "GLM_BASE_URL" },
  { name: "DeepSeek V4 Pro (产品经理)", model: "deepseek-v4-pro", key: "DEEPSEEK_API_KEY", url: "DEEPSEEK_BASE_URL" },
  { name: "MiniMax M2.7 (程序员)", model: "minimax-m2.7-highspeed", key: "MINIMAX_API_KEY", url: "MINIMAX_BASE_URL" },
];

const TIMEOUT_MS = 30_000;

async function testAPI(test: typeof TESTS[0]) {
  const apiKey = process.env[test.key];
  const baseURL = process.env[test.url];

  if (!apiKey || !baseURL) {
    console.log(`  ❌ ${test.name}: 缺少 ${test.key} 或 ${test.url}`);
    return false;
  }

  console.log(`  🔄 ${test.name}: 测试中...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: test.model,
        messages: [{ role: "user", content: "请回复：连通测试成功" }],
        max_tokens: 50,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`  ❌ ${test.name}: HTTP ${res.status} - ${text.slice(0, 200)}`);
      return false;
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "(无回复)";
    console.log(`  ✅ ${test.name}: ${reply.slice(0, 100)}`);
    return true;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log(`  ❌ ${test.name}: 超时 (${TIMEOUT_MS}ms)`);
    } else {
      console.log(`  ❌ ${test.name}: ${err.message}`);
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

console.log("=== API 连通性测试 ===\n");

let passed = 0;
for (const test of TESTS) {
  const ok = await testAPI(test);
  if (ok) passed++;
}

console.log(`\n=== 结果：${passed}/${TESTS.length} 通过 ===`);
if (passed === TESTS.length) {
  console.log("✅ 阶段1完成：所有 API 连通正常！");
} else {
  console.log("❌ 部分 API 不通，请检查 .env 配置");
}
