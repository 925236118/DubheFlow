# 天枢 · 开发计划 (v0 Walking Skeleton)

> 本计划对应设计文档中的 **v0 纵向打穿**:对话 → AI 生成 spec → 校验 → 执行 → 规则验证 → git 每步 commit + 回退;只读画布 + 拖入单节点。
>
> 上游设计:`D:\workspace\Obsidian\moshangzhu\进行中的项目\天枢\` 五份文档。
>
> 执行顺序:**Electron 骨架 → DeepSeek 接入 → 持久化 → spec/注册表 → Planner → 执行器 → git 快照 → 可视化 → 串联验收**。

---

## Phase 0 — Electron 应用骨架 ✅

- [x] 0.1 项目脚手架:electron-vite + React + TypeScript + ESLint/Prettier
- [x] 0.2 主进程入口:窗口创建、单实例锁、`will-quit` 清理钩子预留
- [x] 0.3 preload 脚本:通过 `contextBridge` 暴露受控 IPC API(contextIsolation 开启)
- [x] 0.4 渲染进程骨架:React + 基础三栏布局(左侧对话 / 右侧画布占位 / 顶部工具栏)
- [x] 0.5 目录结构定型:`electron/main`、`electron/preload`、`src`(renderer)、`docs`、`resources`
- [x] 0.6 构建配置:dev 启动脚本 + 打包基础配置(electron-builder 留口)
- [x] 0.7 `userData` 目录约定:`<userData>/services/`、`<userData>/db/`、`<userData>/logs/`

## Phase 1 — DeepSeek 模型接入 ✅

- [x] 1.1 `ModelProvider` 抽象层:`id` / `locality` / `capabilities` / `invoke()` / `estimateCost()`
- [x] 1.2 OpenAI 兼容客户端:chat completions(流式 + 非流式)、vision(image_url)、重试/超时/限流(令牌桶)
- [x] 1.3 DeepSeek Provider 实现:`deepseek-chat`(coding/text/vision)、`deepseek-reasoner`(reasoning)
- [x] 1.4 密钥管理:Electron `safeStorage` 加密存储,主进程独占,renderer 走 IPC
- [x] 1.5 服务 manifest 落地:`builtin/deepseek.yaml`(auth/health/nodes/cost/exec)
- [x] 1.6 路由表:capability → provider 映射,用户可编辑(配置存 safeStorage / SQLite)
- [x] 1.7 健康检查:`health` 探测(key 是否有效、余额是否足够)
- [x] 1.8 成本记账:`model_call` 记录 token / 延迟 / 费用
- [x] 1.9 设置页:填 key、选默认 capability 绑定、连通性测试

## Phase 2 — SQLite 持久化 ✅

- [x] 2.1 数据库初始化:WAL + `busy_timeout`,主进程独占句柄
- [x] 2.2 Schema 建表:project / conversation / message / workflow / workflow_revision / run / step_run / model_call / tool_call / approval / artifact / rollback
- [x] 2.3 迁移机制:版本号 + 迁移脚本,启动时自动 upgrade
- [x] 2.4 IPC 数据访问层:renderer 全走 IPC,封装为 Repository 模式
- [ ] 2.5 sqlite-vec 扩展接入(为 workflow_vec 检索预留,可先空表)

## Phase 3 — Spec 与原语注册表 ✅

- [x] 3.1 spec TypeScript 类型定义(对齐设计文档 §3)
- [x] 3.2 内置原语注册表:18 个内置原语(collect/require/approve/llm_generate/classify/extract/split/fanout/join/assemble/branch/loop/rollback_to/tool_call/apply_change/godot_check/run_test/verify)
- [ ] 3.3 服务贡献节点注册:从 manifest 自动加载到注册表(ManifestProvider 已实现,未合并到校验器)
- [x] 3.4 数据流取值引擎:`{{ }}` 文本插值 + `$ref` 整体引用 + 三类命名空间 + 作用域
- [x] 3.5 静态校验器:未定义引用 / 作用域越界 / 类型不符 / 循环数据依赖 / 必填缺失 / 有环无上限 / 不可达节点 / 预算缺失 / 审批被绕过
- [x] 3.6 `input_hash` 计算(引用解析之后)
- [x] 3.7 内置全局变量表:`PROJECT_PATH` / `SCRIPT_DIR` / `ART_DIR` / `RUN_ID` …

## Phase 4 — 工作流生成(Planner)✅

- [x] 4.1 注册表 → Planner 系统提示词自动生成(原语 schema + 可用节点 + 变量清单)
- [x] 4.2 对话驱动生成:接收任务 → 调 DeepSeek 产出 spec JSON
- [x] 4.3 输出约束:JSON 模式 + 容错解析(去 markdown / 提取 {})
- [x] 4.4 生成门禁:静态校验不过 → 打回重生成(带失败原因)
- [x] 4.5 草稿态 revision 入库

## Phase 5 — 工作流执行器(Interpreter)🔄

- [x] 5.1 解释器骨架:读 spec → 拓扑排序 → 逐节点执行 → 写 step_run
- [ ] 5.2 检查点:每步 input/output 落库,支持复用(input_hash 一致则跳过)
- [ ] 5.3 节点执行适配器:`openai_chat` / `cli` / `bridge_rpc` / `module`(当前直接用 registry.invoke)
- [x] 5.4 `verify` 原语:规则链优先(退出码 / stderr grep / 文件存在 / 空输出)
- [ ] 5.5 `rollback_to` 语义:废弃标记 + 分叉结构 + 两层次数限制
- [ ] 5.6 `fanout` / `join`:并行分支 + 失败策略
- [ ] 5.7 预算闸门:运行前预估 + 超预算暂停询问
- [ ] 5.8 人工审批门禁 `approve`(当前为桩)

## Phase 6 — 项目文件快照(git)🔄

- [x] 6.1 git 操作封装(spawn git,GitOps 类)
- [ ] 6.2 run 启动:建 `agent/run_<id>` 分支 + 记 `vcs_base_commit`(方法已实现,未接入 Interpreter)
- [ ] 6.3 脏工作区处理:先提交 / 先 stash(需用户确认)
- [ ] 6.4 每步 commit:message 带步骤号 + 打 checkpoint tag(方法已实现,未接入 Interpreter)
- [x] 6.5 回退:`git revert` / `git checkout <tag> -- <path>`(方法已实现)
- [x] 6.6 `git diff` 三重用途:验证证据 / 审批展示 / 回退粒度(diff/diffStat + IPC)
- [ ] 6.7 项目检测:非 git 仓库提示初始化;检测 LFS / 大文件

## Phase 7 — 可视化界面 🔄

- [x] 7.1 对话面板:消息流 + 输入框 + 流式渲染 + 智能滚动 + 失败重试
- [x] 7.2 只读画布:React Flow 渲染 spec(节点状态:等待/运行中/成功/失败/已废弃)
- [ ] 7.3 双向联动:点节点跳对话段;对话改 → 画布同步
- [ ] 7.4 节点详情面板:日志 / diff / 成本
- [ ] 7.5 服务面板:按服务分组,拖入单节点(回写对话)
- [ ] 7.6 运行时控制:暂停 / 跳过 / 重试某节点
- [ ] 7.7 审批 UI:diff 渲染 + 确认/拒绝

## Phase 8 — v0 串联验收

- [ ] 8.1 端到端走通:对话生成线性 spec → 校验 → 执行 → 规则验证 → git 回退
- [ ] 8.2 三个真实 spec 案例:1 线性 / 1 fanout / 1 带 rollback,手工跑通
- [ ] 8.3 成本与耗时报告
- [ ] 8.4 文档:README 更新 + 架构说明

---

## 后续版本(计划外备忘)

- **v1**:小模型 verify + 人工审批 + 工作流库/版本化 + 手工连线
- **v2**:fanout 并行 + join + 多模态验证 + 全面服务接入(图像/视频/音乐/语音)
- **v3**:Godot 插件 + 场景操作 + LSP/DAP + 导出打包

---

*本地决策,远程生成。规则优先,模型兜底。*
