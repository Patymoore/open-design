# AMR latency: session reuse + prompt-cache efficiency

Status: proposed · Parent: #3408 · Sibling: agent-startup-latency-profiling.md (#4504) · Spec format: spec-battle

## Why · 为什么要做

- **用例**:接手 #3408 性能线,严格 profiling 后发现 AMR 每轮首 token ~11s 的真实大头,且根因和落点都定位清楚了。
- **痛点**:① 延迟——AMR 续轮 TTFT p50 ~11s,用户每发一句要等 ~11s;② 成本/稳定性——AMR 每轮重付 100-153k input token,直接烧 AMR Cloud balance,而 `insufficient_balance` 是 AMR 失败第一大(7,053/周,#4455 在打)。**这条 perf 优化同时是 stability 优化**。

## Sources · 事实源(已在本会话逐条核实)

- **Repo / 拉取**:`nexu-io/open-design`(main)+ 本地 vela 仓库 `~/Documents/vela`(HEAD `fe8266e`)。
  - `gh repo clone nexu-io/open-design && git checkout main`;vela 已在本地。
- **vela 侧(根因,已核实)**:`~/Documents/vela/apps/cli/internal/agent/acp_runtime.go`
  - `:248` `"loadSession": false` —— vela 自报不支持加载/恢复 session。
  - `newSession` 内 `if runtime.sessionID != "" { return ... "only one ACP session is supported" }` —— 一进程只允许一个 session。
  - `handleRequest` switch 只处理 `initialize / session/new / session/set_model / session/prompt` —— **没有 `session/load`**,default→"Method not found"。
- **open-design daemon 侧(已核实)**:
  - `apps/daemon/src/server.ts:7670` —— `composed` = `# Instructions{易失系统块}` + `# User request{拍平 transcript}`;`prompts/system.ts:632` BASE_SYSTEM_PROMPT 在前、`:637` memoryBody 等易失块在后。
  - `apps/web/src/providers/daemon.ts:222` —— `buildDaemonTranscript` 每轮把历史拍平成 content-only markdown blob、丢 thinking/tool_use/tool_result。
  - `apps/daemon/src/runtimes/defs/amr.ts`(`acp-json-rpc`,无 `resumesSessionViaCli`)→ `server.ts:7578` `agentSupportsSessionResume=false` → `skipTranscript:false` → **AMR 每轮重发拍平历史**。(对比 claude.ts `resumesSessionViaCli:true` → 已 resume。)
  - `apps/daemon/src/runtimes/mcp.ts:13-22` —— daemon 注入的 MCP:AMR(mature-acp)+1 个 live-artifacts;claude 走用户 external MCP。
- **数据源**:PostHog project **OpenDesign=420348**(`run_finished`,需 `phx_` key);Langfuse `us.cloud.langfuse.com`(trace_id==run.id)。查询见 Reproduction 段。
- **访问前提**:PostHog personal key 复跑;vela 改动需本地 vela 仓库(已具备)。

## 实测数据底座（真实生产客户端 + 本地 daemon）

- AMR TTFT:turn-1 p50 ~11.7s,turn-2+ p50 ~10.9-11.1s(占 ~90% 的 run);命中 vs 未命中 10.9s vs 13.3s。
- **每轮未缓存 input(大头)**:AMR turn-1 ~100.7k、turn-2+ ~153.2k(claude 91k/126k)。首轮总输入 ~281k(claude ~629k)——Open Design 前置系统+工具+DS+skill+discovery。
- 缓存效率:AMR ~73%(命中读 392k / 仍重付 143k);claude ~93%。
- 本地真实 daemon claude(极简轮)拆段:setup 1.67s + 模型首字节 3.14s(claude 自报 `[API:timing] first byte 3140ms`)。
- 排除项:bun install 不进用户 TTFT(ship 版 opencode 自包含,实测);进程冷启动非大头。

## Goals / Non-goals

- **Goals**:把 AMR 每轮重付的 100-153k 未缓存 input 砍到"只剩本轮新内容",降 TTFT + 降 token 成本。
- **Non-goals**:claude(已 resume);provider 侧首 token 地板(~3s,网络多跳+模型本身);opencode 直连 31s 异常(单列待查)。

## Root cause

AMR 每轮重付 100-153k 未缓存 = 把"模型上一轮已处理过、逐字节相同的历史"重新喂、重新算。根因:
1. **vela 不支持 session 复用**(`loadSession:false` + 单 session + 无 `session/load`)→ 每轮 `session/new` 从头来;
2. **daemon 每轮把历史拍平成新 user 消息**(`buildDaemonTranscript`)→ 前缀和上一轮原生结构对不上;
3. **易失系统块**(MCP/记忆/runContext)穿插在系统前缀里 → 提前截断可缓存前缀(对显式缓存模型)。

## Proposed design

两个杠杆,**按缓存类型决定要不要碰 cache_control**:

### 杠杆 A — session 复用(**通用必改**,对所有会缓存的模型都有用)
- vela 三处改:① `initialize` 把 `loadSession` 改 `true`;② `handleRequest` 加 `case "session/load"`;③ 持久化 opencode session(现 session id 只在内存)。
- daemon 配合:resume-capable 判定纳入 AMR/ACP(或专门路径),改成「一对话一条长存活 ACP 连接、按轮 `session/prompt`」,不再每轮重发拍平历史。
- 效果:turn-2+ 未缓存从 153k → 只剩本轮新内容。

### 杠杆 B — cache_control 透传 + 稳定前缀(**只对显式缓存模型**:Claude/Gemini)
- 自动缓存模型(**DeepSeek、OpenAI**)**不需要**——AMR 头部模型 `deepseek-v4-flash` 就是自动缓存,只要前缀稳定 + 不重发即可。
- 显式缓存模型(走 Vertex 的 Claude / Gemini):需在 opencode/vela 发上游时带 `cache_control` 断点 + 把易失系统块挪到稳定断点之后。
- 分层断点:`[通用核心]断点[项目稳定]断点[易失]断点[user]` —— 通用核心**跨用户共享**(见下)。

### 缓存模型分类（写给实现者）
| 模型 | 缓存 | 读折扣 | TTL | 要 cache_control |
|---|---|---|---|---|
| Claude(Vertex/直连) | 显式 | 0.1× | 5m/1h(写 1.25×/2×) | 要 |
| DeepSeek(AMR 头部) | 自动 | ~0.1× | 自动 | 不要 |
| OpenAI | 自动 | ~0.5× | 短/不可控 | 不要 |
| Gemini | 显式 ctx cache | ~0.25–0.75× | 可配 | 要 |

### 缓存作用域 + TTL（设计约束）
- **作用域 = 上游账号/项目级,非全局、不跨组织**。AMR 走**共享后端账号**(AMR Cloud)→ **通用系统前缀可跨用户共享**:写一次、全用户读(0.1×)、高并发自保 warm → **turn-1 对 TTL 免疫**。claude_code 是 BYOK 自己账号 → 不跨用户。
- **turn-2+ 单会话历史会被 TTL 咬**(人类两轮间常 >5min)→ 用 **1h 扩展 TTL** + 一对话一进程保活。

## 预期收益（量化 + 置信度）

| 轮次 | 现状未缓存 | 手段 | 砍后 | TTFT |
|---|---|---|---|---|
| turn-1 | ~100k | 通用前缀跨用户共享 + 稳前缀(显式模型加 cache_control) | 只剩首条消息 | 估 ~6-7s |
| turn-2+(~90%) | ~153k | session 复用(vela) | 只剩本轮新内容 | **~11s → 估 ~6-7s** |

- **延迟**:AMR 续轮 ~11s → 估 ~6-7s(约 −40%),覆盖 ~90% run。
- **成本/稳定性**:每轮少处理 ~100-150k token → 少烧 balance → **缓解 insufficient_balance(#4455 第一大失败)**。
- **置信度**:"现状 11s / 未缓存 100-153k" 是生产实测(硬);"砍后 6-7s" 是基于"模型首字节随未缓存量缩"的推算,**精确值实现完再验**;地板 ~3s(网络+模型,实测)动不了。
- **范围注**:AMR 体量 ~4.4k 成功 run/周(< claude 73k),绝对 reach 小,但 AMR 是付费托管层,per-user 体验 + 成本敏感,且有 stability 联动。

## Risks & mitigations

- **跨仓 vela**:session/load + 持久化是 vela 改动;用户 own vela,非阻塞;需 vela 测 + open-design daemon 联调。
- **正确性**:session 复用别重蹈 #3380 丢编辑状态;改模型/cwd/agent/cancel 要有 session 失效与回落。
- **TTL 慢对话**:1h 扩展 TTL + 保活缓解;仍有极慢对话 miss(可接受)。
- **埋点缺口**:AMR `cache_creation` 字段为空(疑 vertex 不上报)→ AMR 缓存账可能不全,验收时补埋点。
- **observability**:加 `cache_efficiency` / 续轮 uncached_tokens 看板,防优化衰退。

## Validation · 验收（behavior-level）

- before/after：AMR 续轮 `time_to_first_token_ms` p50 下降;`input_tokens`(未缓存)从 ~153k 显著下降;`cache_read/(cache_read+input)` 效率上升(目标趋 claude 的 ~93%)。
- 一条可证伪：同 `conversationId` 连发两轮,断言第二轮 `input_tokens` << 第一轮(session 复用后历史不再重付)。
- 不需要 #3545 QA gate（不改模型输入语义/输出，纯减少重发与重算）。

## Regression guard（防衰退）

- prompt-stack 字节级 golden test：可缓存通用前缀在仅易失输入变化时逐字节不变（复用 `prompt-telemetry.ts` 的 section fingerprint）。
- STABLE/VOLATILE 分类强制：新增 prompt 段未分类即测试红，逼声明落点（随功能演进自守）。
- 线上 cache 效率 + 续轮 uncached 看板 + 告警。

## Feasibility review（codex GPT-5.5,已 ground-check vela + provider docs)— 修正与重排

这份的可行性被 codex 逐前提核过,有实质修正,**按此为准**:

1. **缓存其实已在 Vela Link 网关侧做了**(`services/link/internal/bifrostengine/prompt_cache.go`):网关把 OpenAI 兼容 body 转 Bifrost 后,**给 system/developer 内容注入 cache control**(`:173/340`)、剥掉客户端不支持的 directive(`:107`),且按**有限个 cache 断点**(`markChatContentCacheable(content, remaining)`)。→ **不需要从 ACP 透传 cache_control**;但**只注入 `{type: ephemeral}`、无 TTL** → 默认 5min,**1h 没接**。
2. **provider 表修正**:DeepSeek 读折扣**不是 0.1×**——**vela 自己 billing 写 deepseek-v3.2 读 0.5×**(`services/api/src/billing.ts:170`);**AMR 实际模型偏好 = DeepSeek/GLM/Gemini**,非 Claude/OpenAI(`runtimes/defs/amr.ts:8`)。Anthropic 数核对无误。OpenAI/Gemini 按 model/config 变。
3. **session 复用 = 架构改造,不是配置开关**(单点最大风险):opencode `serve` 原生支持多轮(`/session/{id}/prompt_async`),"单 session/无 load"是 vela ACP 选择;**但 vela 每轮建/删 opencode temp home**(`opencode_process.go:336/376`)→ session 随之销毁,且**"fresh serve 进程能否 reload 持久化 session"未验证**。要做需:停 temp 销毁 + 持久化 + 证明 opencode reload + daemon 一对话一进程。
4. **跨用户共享缓存 = 架构上成立、生产未证**:Vela Link 上游凭据从**服务端 catalog 选、非每用户传**(`account.go`)→ 能共享 provider 账号;但路由按 key 加权、生产 catalog 布局未验。
5. **1h TTL 未接**:Anthropic 支持 `ttl:"1h"`,但 Vertex/Bedrock 上自动缓存不支持、只认显式断点;Vela Link 默认只 ephemeral 无 TTL(`prompt_cache.go:340`)→ Vertex-Claude 走这条的 1h 未验。

**因此重排两步(难度/可行性修正后):**
- **Step 1(小、更可行,先做)**:Vela Link 把 ephemeral 改 **1h TTL** + 保证可缓存前缀稳定。只帮显式缓存模型(Claude/Gemini),DeepSeek 自动缓存 TTL 不可设——收益部分。
- **Step 2(大、是项目)**:session 复用(停 temp 销毁 + 持久化 + 验 opencode reload + daemon 一对话一连接)。吃 turn-2+ 那 153k 的大头,但需立项。

> 据此,本优化**不是低垂果实,是一个需要立项的 vela 跨仓项目**;Step 1 相对小,但收益受"AMR 头部是自动缓存模型(DeepSeek/GLM)"限制。

## Open questions

- vela session/load 后,opencode session 持久化粒度（按 conversation？失效条件？）。
- AMR 各模型走的上游账号是否真共享（确认 turn-1 跨用户缓存假设）。
- opencode 直连 p50 31s 异常是否同源（单独 issue）。

## Reproduction · 复现

PostHog OpenDesign=420348,`POST /api/projects/420348/query/`。HogQL：数值用 `toFloat()`,null 用 `isNull()`,P90 用 `quantile(0.9)`,轮次用 `row_number() OVER (PARTITION BY conversation_id ORDER BY timestamp)`。
- 输入构成（turn-1 vs turn-2+）：`avg(toFloat(properties.input_tokens))` / `cache_read_input_tokens` / `cache_creation_input_tokens`，按 `if(turn=1,...)` 分桶。
- 命中 vs 未命中 TTFT：`if(toFloat(properties.cache_read_input_tokens)>0,'HIT','MISS')` 分组。
- vela 核实：`git -C ~/Documents/vela grep -n 'loadSession\|session/load' apps/cli`。
