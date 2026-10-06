# 后端 API 集成测试

**最新：Bun 1.4.2，API 429/429 通过，auth/JWT 73/73 通过，TypeScript 检查通过。** 初测 197 项的 16 个失败断言全部保留并转绿；另一个 workflow 代理补充对话 SSE 用例后核心套件为 198 项。最终完整报告位于 `/tmp/chatgym-backend-api-final.md`。

## 运行

从后端仓库根目录执行：

```bash
# 全部 API：429 项，不访问外部模型或真实 Mem0
bun run test:api

# 优先验证真实注册、登录、me 和 JWT：73 项
API_REPORT_PATH=/tmp/chatgym-api-auth.json bun test tests/api/api.integration.test.ts --test-name-pattern '01 auth|02 JWT'

# 独立模块
bun test tests/api/api.integration.test.ts --test-name-pattern '03 CORS|04 memory|05 text|06 plan|07 VLM'
bun test tests/api/multipart.validation.test.ts
bun test tests/api/text-metadata.validation.test.ts
bun test tests/api/memory-crud.integration.test.ts

# 仓库检查；联合全仓回归由根代理统筹
bun run typecheck
bun run test

# 显式启用真实模型验证，可能产生费用；记忆仍使用测试 adapter
bun run test:api:real
```

不要加 `--concurrent`：模型契约测试会临时替换全局 fetch 和模型配置，然后在 finally 中恢复。真实模型脚本应作为独立进程运行。

## 最终测试统计

| 测试文件 | 场景 | 通过 | 失败 |
| --- | ---: | ---: | ---: |
| `api.integration.test.ts` | 198 | 198 | 0 |
| `multipart.validation.test.ts` | 76 | 76 | 0 |
| `text-metadata.validation.test.ts` | 13 | 13 | 0 |
| `memory-crud.integration.test.ts` | 79 | 79 | 0 |
| `chat-history.integration.test.ts` | 63 | 63 | 0 |
| **合计** | **429** | **429** | **0** |

核心 198 项含 auth 30、JWT及9条受保护路由矩阵43、CORS12、训练记忆15、text12、plan及stream46、VLM及stream40。auth/JWT 的73项包含在198项内，不重复计数。

最终 API 日志：`/tmp/chatgym-api-final.log`，约2.44秒，1784个 expect 断言；类型检查日志：`/tmp/chatgym-api-final-typecheck.log`。核心198项逐请求报告：`/tmp/chatgym-api-final-core.json`；Mem0 CRUD79项逐请求报告：`/tmp/chatgym-api-memory-crud.json`。

## 登录与隔离

测试先通过真实 register/login 注册两个测试用户并获得 JWT。register 返回201，token立即能读取me；login返回200并更新lastLoginAt；重复注册返回409 `username already exists`；错误密码和未知用户均401 `invalid username or password`。不存在、无效签名、篡改、过期、未来nbf、缺少/非法claims、不存在用户、alg=none均被拒绝。

伪造memory.userId、plan.user.id、text.userId/username不会改变写入者；训练记忆读取他人ID为403，文本读取他人记录为404。计划检索和模型提示不含另一用户私密标记。通用记忆创建、搜索、列表、更新、删除一律使用JWT的currentUser.id；body和query中的伪造ID不生效，更新/删除他人和不存在记录均404。

## 修复与历史失败证据

初测197项为181通过、16失败，证据仍保存在 `/tmp/chatgym-api-integration.json` 和 `.log`。

- **metadata数组被接受（1项）**：`POST /api/text {text:'x',metadata:[]}` 原返回201且转成 `{}`。现在在Elysia Record规范化前检查原始类型，数组、null和基本类型均返回422 JSON；合法对象和对象内数组保留。
- **非法multipart JSON返回500（6项）**：plan的payload，以及VLM的purposes/details传入`{broken`，原返回纯文本500。现在JSON解析和字段类型错误返回422 `{message:'invalid JSON payload'}`，在SSE/模型调用前拒绝；兼容request别名，合法purpose/detail数组继续通过。
- **Bun升级后的二次读body**：Bun1.4.2中合法JSON/multipart曾返回422。四条手动解析Agent路由设置`parse:'none'`，在鉴权后只读取Request一次。
- **相机data URL/multipart失败（8项）**：原普通接口500 `URL scheme must be http or https, got data:`；流接口HTTP200但终态error、没有final。workflow代理已完成图片二进制转换及校验，原断言全部转绿。本会话不编辑图片转换或workflow文件。
- **dialog强制周计划规范化（1项）**：原自然语言回答追加一次模型调用并返回周计划。workflow代理已修复原文及终态事件，原调用次数断言仍保留且通过，另补对话SSE测试。

## Mem0接口

训练记忆已有接口的storeSessions、listRecent和getUserSessionCount全部await；请求成功后返回已完成写入的IDs与数字计数。

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| POST `/api/agent/memory/items` | `{memory:string}`，1至10000字符，不能全空白 | 201 `{status:'stored',item:StoredMemory}` |
| GET `/api/agent/memory/search` | `query`非空，最多2000字符；`limit`可选 | 200 `{items:StoredMemory[]}` |
| GET `/api/agent/memory/items` | `limit`可选 | 200 `{items:StoredMemory[]}` |
| PATCH `/api/agent/memory/items/:id` | `{memory:string}`，同创建校验 | 200 `{status:'updated',item:StoredMemory}` |
| DELETE `/api/agent/memory/items/:id` | 记忆ID | 200 `{status:'deleted',id}` |

通用limit默认10，允许1至50整数，非法值返回422。手动创建调用createMemory，infer:false精确保留空白、Unicode和原文，生成来源UUID；客户端不能覆盖owner或metadata。searchMemories使用Store定义的conversation范围；listMemories包含本人各类记忆。

MemoryUnavailableError映射为503可操作配置消息，MemoryNotFoundError映射为404。JSON plan/dialog的Mem0失败也传播为503，不先调用模型。已经开始发送SSE的工作流失败仍通过终态error报告。缺少Mem0配置时me/health继续可用；health摘要只表示Store本地观察到的训练记录，不表示远端全量统计。

## chatHistory隔离修复

新增planRequestSchema.chatHistory：可省略，默认[]，最多14条，每条role只接受user/assistant，text最多2000字符。PlanRequestInput保持字段可选，兼容既有内部请求构造；不新增顶层message。goal.requestNote只表示当前用户文本，不拼接历史。

新增63项真实API回归：JSON/multipart的plan/stream均校验非法角色、字段类型、2001字符和15条历史；合法历史按原role/text进入SDK提示词。只有当前requestNote写入Mem0，历史用户/助手标记都不进入memory/sourceInput；单独历史不写记忆。省略字段、14条各2000字符、multipart request别名均兼容。Workflow代理只在prompts使用历史，前端sessiongeneration由前端代理防止账户切换旧历史发送。

单独命令：`bun test tests/api/chat-history.integration.test.ts`；日志：`/tmp/chatgym-api-chat-history.log`。该隔离修复不把历史助手建议当作用户事实；客户端提交的历史只作为上下文，不能推断其账户归属。

## 隔离与真实链路局限

fixture现在为 `new WorkoutMemoryStore(new FakeMem0Adapter())`；UserStore默认使用`:memory:`。保留createHarness/withModelReplies供workflow测试复用；所有直接训练记忆读写都已await。路由、JWT、AI SDK、工具、工作流、审核、异步Store facade和SSE真实执行；模型HTTP、测试HTTPS图片和Mem0 adapter是假实现。测试不会调用真实Qdrant、embedding或Mem0模型，不改现有用户数据、旧SQLite或4000端口会话。

真实模型独立尝试使用工具网络权限：register201、login200，外部`https://api.siliconflow.cn/v1/chat/completions`返回403，后端plan返回500 `Forbidden`。证据为 `/tmp/chatgym-api-real-model.json` 和 `/tmp/chatgym-api-real-model-fixed.log`；不能据此判断403具体原因或证明真实生成成功。真实Mem0/Qdrant验证由Mem0代理负责。

旧 `src/agent/data/workout-memory.sqlite` 测试前后SHA-256一致：`ef56c48b6e1e036d476a7d6c9a61f957b8e429e2c1ddcd7cd27996a5ee371dc4`。

app.handle不包含TCP监听、浏览器CORS执行、真实WebSocket、部署网络、流式时延/背压或客户端取消。用户提供的前端49项统计不并入后端数字；前端无效token状态恢复、409提示和null-token拍照仍需前端独立回归。

根代理最新联合结果（转达）：`API_REPORT_PATH=/tmp/chatgym-api-root-final.json bun test` 为498通过、5跳过、0失败；typecheck/diff-check为0。另行真实Mem0 SDK+Qdrant集成为1通过、18断言，4个性能跳过仍可选。本目录独立API为429/429；未重写根代理日志。前端userId命名空间修复仍由前端/根代理推进。
